#!/usr/bin/env python3
"""Mirror Mocap tracker.

Webcam -> MediaPipe (body / face / hands) -> UDP JSON packets for the Unity viewer.
The three AI models run in MediaPipe's own threads (LIVE_STREAM mode), so they work in parallel.

    python tracker.py                 # default camera, send to 127.0.0.1:39540
    python tracker.py --camera 1      # another camera
    python tracker.py --quality light # lighter body model, hands every other frame
    python tracker.py --video clip.mp4 --frames 60 --print   # test without a camera
"""
import argparse
import json
import math
import pathlib
import socket
import threading
import time
import urllib.request

import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

MODEL_URLS = {
    "pose_lite": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
    "pose_full": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
    "pose_heavy": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task",
    "face": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    "hand": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
}
POSE_FOR_QUALITY = {"light": "pose_lite", "standard": "pose_full", "high": "pose_heavy"}
MODEL_DIR = pathlib.Path(__file__).resolve().parent / "models"


def ensure_model(key: str) -> str:
    """Download a model file on first use and return its local path."""
    MODEL_DIR.mkdir(exist_ok=True)
    path = MODEL_DIR / (key + ".task")
    if not path.exists() or path.stat().st_size == 0:
        print(f"AIモデルをダウンロード中: {key} ...", flush=True)
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(MODEL_URLS[key], tmp)
        tmp.replace(path)
    return str(path)


class Latest:
    """Newest result from each model, written by MediaPipe's callback threads."""

    def __init__(self):
        self.lock = threading.Lock()
        self.pose = self.face = self.hand = None
        self.counts = {"pose": 0, "face": 0, "hand": 0}
        self.dirty = False

    def setter(self, name):
        def cb(result, _image, _ts):
            with self.lock:
                setattr(self, name, result)
                self.counts[name] += 1
                self.dirty = True
        return cb


def r4(v):
    return round(float(v), 4)


def build_packet(latest: Latest, w: int, h: int) -> dict:
    with latest.lock:
        pose, face, hand = latest.pose, latest.face, latest.hand
        latest.dirty = False
    pkt = {"v": 1, "t": time.time()}
    pimg = None
    if pose and pose.pose_world_landmarks:
        world, norm = pose.pose_world_landmarks[0], pose.pose_landmarks[0]
        pkt["pose"] = [r4(c) for l in world for c in (l.x, l.y, l.z)]
        pkt["vis"] = [round(float(l.visibility or 0.0), 3) for l in norm]
        pimg = norm

    # hands: assign to the subject's left / right with the body AI's wrists (more reliable than the label)
    hand_pts = []
    if hand and hand.hand_world_landmarks:
        for i, img_lms in enumerate(hand.hand_landmarks):
            hand_pts += [(p.x, p.y) for p in img_lms[::4]]
            if pimg is not None:
                d = lambda j: math.hypot(pimg[j].x - img_lms[0].x, pimg[j].y - img_lms[0].y)
                subj = "hl" if d(15) < d(16) else "hr"
            else:
                label = hand.handedness[i][0].category_name if hand.handedness else "Left"
                subj = "hr" if label == "Left" else "hl"  # label assumes a mirrored image; ours is not
            if subj not in pkt:
                pkt[subj] = [r4(c) for l in hand.hand_world_landmarks[i] for c in (l.x, l.y, l.z)]
    if pimg is not None:
        hand_pts += [(pimg[j].x, pimg[j].y) for j in (15, 16, 19, 20) if (pimg[j].visibility or 0) > 0.5]

    if face and face.face_landmarks:
        f = face.face_landmarks[0]
        pkt["face"] = [r4(c) for j in (33, 263, 10, 152)
                       for c in ((f[j].x - 0.5) * w, (f[j].y - 0.5) * h, f[j].z * w)]
        bs = {c.category_name: c.score for c in (face.face_blendshapes[0] if face.face_blendshapes else [])}
        g = lambda n: float(bs.get(n, 0.0))
        look_left = ((g("eyeLookOutLeft") + g("eyeLookInRight")) - (g("eyeLookOutRight") + g("eyeLookInLeft"))) / 2
        look_up = (g("eyeLookUpLeft") + g("eyeLookUpRight") - g("eyeLookDownLeft") - g("eyeLookDownRight")) / 2
        pkt["bs"] = [round(x, 3) for x in (g("eyeBlinkLeft"), g("eyeBlinkRight"), g("jawOpen"), g("mouthPucker"),
                                           g("mouthFunnel"), (g("mouthSmileLeft") + g("mouthSmileRight")) / 2,
                                           look_left, look_up)]
        # is a hand in front of the face / near the mouth / near the eyes?
        xs = [p.x for p in f[::6]]; ys = [p.y for p in f[::6]]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        fw, fh = x1 - x0, y1 - y0
        mouth = ((f[13].x + f[14].x) / 2, (f[13].y + f[14].y) / 2)
        eyes = [(f[159].x, f[159].y), (f[386].x, f[386].y)]
        inside = sum(1 for x, y in hand_pts if x0 - .04 * fw < x < x1 + .04 * fw and y0 - .04 * fh < y < y1 + .04 * fh)
        near_mouth = any(math.hypot(x - mouth[0], y - mouth[1]) < .33 * fw for x, y in hand_pts)
        near_eyes = any(math.hypot(x - ex, y - ey) < .22 * fw for x, y in hand_pts for ex, ey in eyes)
        pkt["occ"] = [int(inside >= 2), int(near_mouth), int(near_eyes)]
    return pkt


def main():
    ap = argparse.ArgumentParser(description="Mirror Mocap tracker (webcam -> Unity)")
    ap.add_argument("--camera", type=int, default=0, help="camera number (0, 1, ...)")
    ap.add_argument("--video", help="use a video file instead of the camera (loops)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=39540)
    ap.add_argument("--quality", choices=["light", "standard", "high"], default="standard")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--preview", action="store_true", help="show the camera image with tracking dots")
    ap.add_argument("--frames", type=int, default=0, help="stop after N packets (for testing)")
    ap.add_argument("--print", action="store_true", help="print each packet summary")
    args = ap.parse_args()

    latest = Latest()
    live = vision.RunningMode.LIVE_STREAM
    opt = lambda key: BaseOptions(model_asset_path=ensure_model(key))
    pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=opt(POSE_FOR_QUALITY[args.quality]), running_mode=live, num_poses=1,
        result_callback=latest.setter("pose")))
    face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=opt("face"), running_mode=live, num_faces=1, output_face_blendshapes=True,
        result_callback=latest.setter("face")))
    hands = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=opt("hand"), running_mode=live, num_hands=2,
        result_callback=latest.setter("hand")))

    if args.video:
        cap = cv2.VideoCapture(args.video)
    else:
        backend = cv2.CAP_DSHOW if hasattr(cv2, "CAP_DSHOW") and __import__("os").name == "nt" else cv2.CAP_ANY
        cap = cv2.VideoCapture(args.camera, backend)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
    if not cap.isOpened():
        raise SystemExit("カメラ（または動画）を開けませんでした。--camera の番号を変えるか、ほかのアプリがカメラを使っていないか確認してください。")

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    print(f"送信先 {args.host}:{args.port}  (Ctrl+C で終了)", flush=True)
    t0 = time.monotonic(); last_ts = -1; frame_no = 0; sent = 0; stat_t = time.monotonic()
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                if args.video:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0); continue
                raise SystemExit("カメラの映像が途切れました。")
            frame_no += 1
            h, w = frame.shape[:2]
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            ts = max(last_ts + 1, int((time.monotonic() - t0) * 1000)); last_ts = ts
            pose.detect_async(img, ts)
            face.detect_async(img, ts)
            # the hand AI is the heaviest: skip it while no wrist is in frame (peek every 8th frame);
            # light mode runs it on every other frame
            with latest.lock:
                pr = latest.pose
            wrists_out = bool(pr and pr.pose_landmarks) and all(
                (pr.pose_landmarks[0][j].visibility or 0) < 0.3 or pr.pose_landmarks[0][j].y > 1.02 for j in (15, 16))
            if (not wrists_out or frame_no % 8 == 0) and (args.quality != "light" or frame_no % 2 == 0):
                hands.detect_async(img, ts)
            elif wrists_out:
                with latest.lock:
                    latest.hand = None

            if args.video:
                time.sleep(1 / 30)  # results arrive asynchronously; pace a file like a camera
            if latest.dirty:
                pkt = build_packet(latest, w, h)
                sock.sendto(json.dumps(pkt, separators=(",", ":")).encode(), (args.host, args.port))
                sent += 1
                if args.print:
                    print({k: (len(v) if isinstance(v, list) else v) for k, v in pkt.items()}, flush=True)
                if args.frames and sent >= args.frames:
                    break

            if args.preview:
                with latest.lock:
                    pr, fr, hr = latest.pose, latest.face, latest.hand
                for lms, color in ([(pr.pose_landmarks[0] if pr and pr.pose_landmarks else []), (255, 196, 124)],
                                   [(fr.face_landmarks[0][::8] if fr and fr.face_landmarks else []), (68, 181, 242)],
                                   [[p for hl in (hr.hand_landmarks if hr else []) for p in hl], (154, 211, 95)]):
                    for p in lms:
                        cv2.circle(frame, (int(p.x * w), int(p.y * h)), 2, color, -1)
                cv2.imshow("Mirror Mocap tracker (q で終了)", cv2.flip(frame, 1))
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

            if time.monotonic() - stat_t > 3:
                dt = time.monotonic() - stat_t; stat_t = time.monotonic()
                with latest.lock:
                    c = latest.counts; latest.counts = {k: 0 for k in c}
                print(f"推定 体{c['pose'] / dt:.0f} 顔{c['face'] / dt:.0f} 手{c['hand'] / dt:.0f} fps", flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        pose.close(); face.close(); hands.close()
        if args.preview:
            cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
