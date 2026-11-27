#!/usr/bin/env python3
"""Test for native/tracker/tracker.py: run it on a video and check the packets it sends to Unity.

    python3 tools/test_tracker.py VIDEO            (a video with a person, e.g. the fake camera video cam.y4m)

Needs the tracker's packages (pip install -r native/tracker/requirements.txt); without them it says so and exits 0.
Each packet must carry the body (33 points), the face (4 points), the 8 face scores and the 7 mood scores,
all of them finite numbers.
"""
import json
import math
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRACKER = ROOT / "native" / "tracker" / "tracker.py"
SIZES = {"pose": 99, "vis": 33, "face": 12, "bs": 8, "mood": 7, "sh": 3}


def main():
    if len(sys.argv) < 2:
        print(__doc__); return 2
    try:
        import mediapipe  # noqa: F401
        import cv2  # noqa: F401
    except ImportError:
        print("skipped: mediapipe / opencv-python are not installed"); return 0
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 0)); sock.settimeout(120)
    port = sock.getsockname()[1]
    proc = subprocess.Popen([sys.executable, str(TRACKER), "--video", str(Path(sys.argv[1]).resolve()), "--port", str(port), "--frames", "40"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    problems, seen = [], {k: 0 for k in SIZES}
    packets = 0
    try:
        while packets < 40:
            try:
                d = json.loads(sock.recv(65536))
            except socket.timeout:
                problems.append("no packet for 120 s"); break
            packets += 1
            for k, n in SIZES.items():
                if k not in d:
                    continue
                v = d[k]
                if not isinstance(v, list) or len(v) != n:
                    problems.append(f"{k}: expected {n} numbers, got {len(v) if isinstance(v, list) else type(v).__name__}")
                elif not all(isinstance(x, (int, float)) and math.isfinite(x) for x in v):
                    problems.append(f"{k}: a value that is not a finite number")
                else:
                    seen[k] += 1
            if all(seen[k] for k in ("pose", "face", "bs", "mood")) and packets >= 10:
                break
    finally:
        proc.kill(); proc.wait()
    for k in ("pose", "face", "bs", "mood"):
        if not seen[k]:
            problems.append(f"never got '{k}' (is there a person in the video?)")
    for p in dict.fromkeys(problems):
        print("×", p)
    print(f"{packets} packets; " + ", ".join(f"{k} {n}" for k, n in seen.items()))
    if not problems:
        print("○ トラッカーの送信内容は正常です")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
