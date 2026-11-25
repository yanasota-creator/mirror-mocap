#!/usr/bin/env python3
"""Mirror Mocap bridge: Web version -> VMC protocol (VSeeFace / Warudo / VNyan ...) and VRChat OSC.

Browsers cannot send UDP, so the web page sends its pose over a WebSocket to this small program,
which forwards it as OSC packets. Standard library only (no pip install needed).

    python bridge.py                      # VMC -> 127.0.0.1:39539, VRChat -> 127.0.0.1:9000
    python bridge.py --no-vrchat          # VMC only
    python bridge.py --vmc 192.168.1.20:39539   # VMC receiver on another PC

Only pages from the allowed origins may connect (the public web version and pages on this PC),
so other websites cannot drive your avatar or write to your VRChat chatbox.
"""
import argparse
import asyncio
import base64
import hashlib
import json
import math
import socket
import struct
import time

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
DEFAULT_ORIGINS = ["https://yanasota-creator.github.io", "http://localhost", "http://127.0.0.1", "null"]

# --------------------------------------------------------------------------- OSC encoding


def _pad(b: bytes) -> bytes:
    return b + b"\0" * (4 - len(b) % 4)


def osc_message(address: str, *args) -> bytes:
    tags, data = ",", b""
    for a in args:
        if a is True:
            tags += "T"
        elif a is False:
            tags += "F"
        elif isinstance(a, int):
            tags += "i"; data += struct.pack(">i", a)
        elif isinstance(a, float):
            tags += "f"; data += struct.pack(">f", a)
        elif isinstance(a, str):
            tags += "s"; data += _pad(a.encode("utf-8"))
        else:
            raise TypeError(type(a))
    return _pad(address.encode()) + _pad(tags.encode()) + data


def osc_bundle(messages) -> bytes:
    out = b"#bundle\0" + struct.pack(">Q", 1)  # timetag 1 = "immediately"
    for m in messages:
        out += struct.pack(">i", len(m)) + m
    return out


# --------------------------------------------------------------------------- coordinates
# The web page sends three.js coordinates (right-handed; the avatar faces +Z, its left hand is +X).
# Unity (VMC, VRChat) is left-handed with the avatar facing +Z and its left hand at -X: mirror X.

def to_unity_pos(p):
    return (-float(p[0]), float(p[1]), float(p[2]))


def to_unity_quat(q):
    return (float(q[0]), -float(q[1]), -float(q[2]), float(q[3]))


def unity_euler(q):
    """Quaternion -> Unity-style Euler angles in degrees (applied Z, then X, then Y)."""
    x, y, z, w = q
    sx = max(-1.0, min(1.0, 2 * (w * x - y * z)))
    ex = math.asin(sx)
    ey = math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y))
    ez = math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z))
    return tuple(math.degrees(a) % 360 for a in (ex, ey, ez))


def unity_bone_name(vrm_name: str) -> str:
    """VRM 1.0 humanoid name -> Unity HumanBodyBones name (as used by the VMC protocol)."""
    n = vrm_name[0].upper() + vrm_name[1:]
    for side in ("Left", "Right"):
        n = n.replace(side + "ThumbProximal", side + "ThumbIntermediate").replace(side + "ThumbMetacarpal", side + "ThumbProximal")
    return n


# VRM 1.0 expression -> VRM 0.x BlendShape preset (the names VMC receivers expect)
VMC_BLEND = {"aa": "A", "ih": "I", "ou": "U", "ee": "E", "oh": "O", "blinkLeft": "Blink_L", "blinkRight": "Blink_R",
             "happy": "Joy", "angry": "Angry", "sad": "Sorrow", "relaxed": "Fun", "surprised": "Surprised",
             "lookUp": "LookUp", "lookDown": "LookDown", "lookLeft": "LookLeft", "lookRight": "LookRight"}

# VRChat OSC trackers 1-8 (head is sent separately so VRChat can line the trackers up with you)
VRC_TRACKERS = ["hips", "chest", "leftFoot", "rightFoot", "leftLowerLeg", "rightLowerLeg", "leftLowerArm", "rightLowerArm"]


def vmc_packets(frame: dict):
    msgs = [osc_message("/VMC/Ext/OK", 1), osc_message("/VMC/Ext/T", float(time.monotonic())),
            osc_message("/VMC/Ext/Root/Pos", "root", 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0)]
    pos = frame.get("pos", {})
    for name, q in frame.get("bones", {}).items():
        px, py, pz = to_unity_pos(pos.get(name, (0, 0, 0)))
        qx, qy, qz, qw = to_unity_quat(q)
        msgs.append(osc_message("/VMC/Ext/Bone/Pos", unity_bone_name(name), px, py, pz, qx, qy, qz, qw))
    # several small bundles keep each UDP packet well under typical size limits
    out = [osc_bundle(msgs[i:i + 24]) for i in range(0, len(msgs), 24)]
    blend = [osc_message("/VMC/Ext/Blend/Val", VMC_BLEND[k], float(v)) for k, v in frame.get("blend", {}).items() if k in VMC_BLEND]
    out.append(osc_bundle(blend + [osc_message("/VMC/Ext/Blend/Apply")]))
    return out


def vrchat_packets(frame: dict):
    out = []
    trk = frame.get("trackers", {})
    for i, name in enumerate(VRC_TRACKERS, 1):
        t = trk.get(name)
        if not t:
            continue
        out.append(osc_message(f"/tracking/trackers/{i}/position", *to_unity_pos(t["p"])))
        out.append(osc_message(f"/tracking/trackers/{i}/rotation", *unity_euler(to_unity_quat(t["q"]))))
    if trk.get("head"):
        out.append(osc_message("/tracking/trackers/head/position", *to_unity_pos(trk["head"]["p"])))
        out.append(osc_message("/tracking/trackers/head/rotation", *unity_euler(to_unity_quat(trk["head"]["q"]))))
    return out


# --------------------------------------------------------------------------- minimal WebSocket server

class Bridge:
    def __init__(self, args):
        self.args = args
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.vmc = _addr(args.vmc) if not args.no_vmc else None
        self.vrc = _addr(args.vrchat) if not args.no_vrchat else None
        self.frames = 0
        self.clients = 0

    def send(self, packets, addr):
        for p in packets:
            try:
                self.sock.sendto(p, addr)
            except OSError:
                pass

    def handle(self, text: str):
        try:
            msg = json.loads(text)
        except ValueError:
            return
        kind = msg.get("type", "frame")
        if kind == "frame":
            self.frames += 1
            if self.vmc:
                self.send(vmc_packets(msg), self.vmc)
            if self.vrc:
                self.send(vrchat_packets(msg), self.vrc)
        elif kind == "chat" and self.vrc:
            text = str(msg.get("text", ""))[:144]  # VRChat's chatbox limit
            self.send([osc_message("/chatbox/input", text, True, bool(msg.get("sound", True)))], self.vrc)
        elif kind == "typing" and self.vrc:
            self.send([osc_message("/chatbox/typing", bool(msg.get("on")))], self.vrc)

    async def client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError):
            writer.close(); return
        lines = head.decode("latin-1").split("\r\n")
        hdr = {k.strip().lower(): v.strip() for k, _, v in (l.partition(":") for l in lines[1:] if ":" in l)}
        origin = hdr.get("origin", "")
        allowed = any(origin == o or origin.startswith(o + ":") for o in self.args.allow_origin)
        if hdr.get("upgrade", "").lower() != "websocket" or "sec-websocket-key" not in hdr or not allowed:
            print(f"接続を拒否しました（許可していないページから: {origin or '不明'}）", flush=True)
            writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"); await writer.drain(); writer.close(); return
        accept = base64.b64encode(hashlib.sha1((hdr["sec-websocket-key"] + WS_GUID).encode()).digest()).decode()
        writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
        self.clients += 1
        print(f"Web版がつながりました（{origin}）", flush=True)
        await self._send_text(writer, json.dumps({"type": "hello", "vmc": _fmt(self.vmc), "vrchat": _fmt(self.vrc)}))
        buf = b""
        try:
            while True:
                b0, b1 = await reader.readexactly(2)
                op, masked, n = b0 & 0x0F, b1 & 0x80, b1 & 0x7F
                if n == 126:
                    n = struct.unpack(">H", await reader.readexactly(2))[0]
                elif n == 127:
                    n = struct.unpack(">Q", await reader.readexactly(8))[0]
                if n > 1 << 20:
                    break  # 1 MB per frame is far more than a pose needs
                mask = await reader.readexactly(4) if masked else b"\0\0\0\0"
                data = bytes(c ^ mask[i % 4] for i, c in enumerate(await reader.readexactly(n)))
                if op == 8:
                    break
                if op == 9:  # ping -> pong
                    writer.write(bytes([0x8A, len(data)]) + data); await writer.drain(); continue
                if op in (0, 1):
                    buf += data
                    if b0 & 0x80:  # final fragment
                        self.handle(buf.decode("utf-8", "replace")); buf = b""
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            self.clients -= 1
            print("Web版との接続が切れました", flush=True)
            writer.close()

    @staticmethod
    async def _send_text(writer, text: str):
        data = text.encode()
        hdr = bytes([0x81, len(data)]) if len(data) < 126 else bytes([0x81, 126]) + struct.pack(">H", len(data))
        writer.write(hdr + data); await writer.drain()

    async def stats(self):
        while True:
            await asyncio.sleep(3)
            if self.clients:
                print(f"受信 {self.frames / 3:.0f} 回/秒", flush=True)
            self.frames = 0


def _addr(s: str):
    host, _, port = s.rpartition(":")
    return (host or "127.0.0.1", int(port))


def _fmt(a):
    return f"{a[0]}:{a[1]}" if a else None


async def main_async(args):
    br = Bridge(args)
    server = await asyncio.start_server(br.client, "127.0.0.1", args.ws_port)
    print(f"ブリッジ起動: Web版からの接続を ws://127.0.0.1:{args.ws_port} で待っています（Ctrl+C で終了）", flush=True)
    print(f"  VMC 送信先: {_fmt(br.vmc) or 'オフ'} / VRChat 送信先: {_fmt(br.vrc) or 'オフ'}", flush=True)
    async with server:
        await asyncio.gather(server.serve_forever(), br.stats())


def main():
    ap = argparse.ArgumentParser(description="Mirror Mocap bridge (web -> VMC / VRChat OSC)")
    ap.add_argument("--ws-port", type=int, default=39541, help="port the web page connects to")
    ap.add_argument("--vmc", default="127.0.0.1:39539", help="VMC receiver host:port (VSeeFace etc.)")
    ap.add_argument("--vrchat", default="127.0.0.1:9000", help="VRChat OSC host:port")
    ap.add_argument("--no-vmc", action="store_true")
    ap.add_argument("--no-vrchat", action="store_true")
    ap.add_argument("--allow-origin", action="append", default=list(DEFAULT_ORIGINS),
                    help="extra page origin allowed to connect (e.g. https://example.com)")
    args = ap.parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        pass
    except OSError as e:
        raise SystemExit(f"ポート {args.ws_port} を開けませんでした（ブリッジがもう起動していませんか？）: {e}")


if __name__ == "__main__":
    main()
