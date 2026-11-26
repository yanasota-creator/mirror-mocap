#!/usr/bin/env python3
"""Mirror Mocap bridge: Web version -> VMC protocol (VSeeFace / Warudo / VNyan ...) and VRChat OSC.

Browsers cannot send UDP, so the web page sends its pose over a WebSocket to this small program,
which forwards it as OSC packets. Standard library only (no pip install needed).

    python bridge.py                      # VMC -> 127.0.0.1:39539, VRChat -> 127.0.0.1:9000
    python bridge.py --no-vrchat          # VMC only
    python bridge.py --vmc 192.168.1.20:39539   # VMC receiver on another PC
    python bridge.py --vmc-in 39542             # also take motion FROM a VMC sender (mocopi, iPhone face apps ...)

Only pages from the allowed origins may connect (the public web version and pages on this PC),
so other websites cannot drive your avatar or write to your VRChat chatbox.
A page opened as a file (file://) has no origin of its own ("null", which any website can also produce
with a sandboxed frame), so it must also send the connection code shown at startup (kept in bridge-code.txt).
"""
import argparse
import asyncio
import base64
import hashlib
import json
import math
import re
import secrets
import socket
import struct
import time
from collections import deque
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
DEFAULT_ORIGINS = ["https://yanasota-creator.github.io", "http://localhost", "http://127.0.0.1"]
CODE_FILE = Path(__file__).with_name("bridge-code.txt")
CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L: easy to read and type
MAX_MESSAGE = 1 << 20  # 1 MB is far more than a pose needs
MAX_CLIENTS = 8


def load_code(path: Path = CODE_FILE) -> str:
    """The connection code for pages opened from a file. Made once and kept, so it only has to be typed once."""
    try:
        code = normalize_code(path.read_text(encoding="utf-8"))
        if len(code) == 8:
            return code
    except OSError:
        pass
    code = "".join(secrets.choice(CODE_CHARS) for _ in range(8))
    try:
        path.write_text(code + "\n", encoding="utf-8")
    except OSError:
        pass  # read-only folder: the code just changes at every start
    return code


def normalize_code(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(s).upper())


def format_code(code: str) -> str:
    return code[:4] + "-" + code[4:]

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


# --------------------------------------------------------------------------- OSC decoding (VMC input)

def _read_str(b: bytes, i: int):
    j = b.index(b"\0", i)
    return b[i:j].decode("utf-8", "replace"), (j + 4) & ~3


def osc_parse(b: bytes, depth: int = 0):
    """OSC packet (message or bundle) -> list of (address, args)."""
    if b.startswith(b"#bundle\0"):
        if depth > 4:
            raise ValueError("bundles nested too deep")
        out, i = [], 16
        while i + 4 <= len(b):
            n = struct.unpack(">i", b[i:i + 4])[0]
            if n <= 0:
                raise ValueError("bad bundle element size")
            out += osc_parse(b[i + 4:i + 4 + n], depth + 1); i += 4 + n
        return out
    addr, i = _read_str(b, 0)
    if i >= len(b) or b[i:i + 1] != b",":
        return [(addr, [])]
    tags, i = _read_str(b, i)
    args = []
    for t in tags[1:]:
        if t == "f": args.append(struct.unpack(">f", b[i:i + 4])[0]); i += 4
        elif t == "i": args.append(struct.unpack(">i", b[i:i + 4])[0]); i += 4
        elif t == "s": v, i = _read_str(b, i); args.append(v)
        elif t == "T": args.append(True)
        elif t == "F": args.append(False)
        elif t == "d": args.append(struct.unpack(">d", b[i:i + 8])[0]); i += 8
        else: break  # unknown type: stop reading this message
    return [(addr, args)]


class VMCIn(asyncio.DatagramProtocol):
    """Collects bones and blendshapes from a VMC sender and hands them to the web page ~30 times a second.
    With --vmc-in-lan anything on the LAN can send here, so names and counts are capped."""

    MAX_BONES, MAX_BLEND = 64, 128

    def __init__(self, bridge):
        self.bridge, self.bones, self.blend, self.last = bridge, {}, {}, 0.0

    def datagram_received(self, data, addr):
        try:
            msgs = osc_parse(data)
        except (ValueError, struct.error, IndexError, RecursionError):
            return
        for a, args in msgs:
            if a == "/VMC/Ext/Bone/Pos" and len(args) >= 8 and _is_name(args[0]) and _all_finite(args[1:8]):
                if args[0] in self.bones or len(self.bones) < self.MAX_BONES:
                    self.bones[args[0]] = [round(float(v), 5) for v in args[1:8]]
            elif a == "/VMC/Ext/Root/Pos" and len(args) >= 8 and _all_finite(args[1:8]):
                self.bones["__root"] = [round(float(v), 5) for v in args[1:8]]
            elif a == "/VMC/Ext/Blend/Val" and len(args) >= 2 and _is_name(args[0]) and _all_finite(args[1:2]):
                if args[0] in self.blend or len(self.blend) < self.MAX_BLEND:
                    self.blend[args[0]] = round(max(0.0, min(1.0, float(args[1]))), 4)
        now = time.monotonic()
        if now - self.last >= 1 / 30 and (self.bones or self.blend):
            self.last = now
            self.bridge.broadcast({"type": "vmc", "bones": self.bones, "blend": self.blend})
            self.bridge.vmc_in_frames += 1


def _is_name(v) -> bool:
    return isinstance(v, str) and 0 < len(v) <= 64


def _all_finite(vals) -> bool:
    return all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in vals)


# --------------------------------------------------------------------------- minimal WebSocket server

class Bridge:
    def __init__(self, args):
        self.args = args
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.vmc = _addr(args.vmc) if not args.no_vmc else None
        self.vrc = _addr(args.vrchat) if not args.no_vrchat else None
        self.frames = 0
        self.clients = 0
        self.writers = set()
        self.viewers = set()
        self.vmc_in_frames = 0
        self.code = getattr(args, "code", None) or load_code()
        self.bad_codes = deque()  # times of wrong codes: after 5 in a minute, file pages are refused for a while

    def check_access(self, origin: str, path: str):
        """-> (allowed, reason). Pages from the allowed origins connect as they are; file:// pages need the code."""
        if any(origin == o or origin.startswith(o + ":") for o in self.args.allow_origin if o != "null"):
            return True, ""
        if origin == "null":
            if "null" in self.args.allow_origin:  # explicitly allowed with --allow-origin null
                return True, ""
            now = time.monotonic()
            while self.bad_codes and now - self.bad_codes[0] > 60:
                self.bad_codes.popleft()
            if len(self.bad_codes) >= 5:
                return False, "接続コードの間違いが続いたので、1分間ファイルからの接続を止めています"
            code = normalize_code(parse_qs(urlsplit(path).query).get("code", [""])[0])
            if code and secrets.compare_digest(code, self.code):
                return True, ""
            self.bad_codes.append(now)
            return False, "ファイルから開いたページ：接続コードが違うか、入力されていません" if code else "ファイルから開いたページ：接続コードを入力してください"
        return False, f"許可していないページから: {origin or '不明'}"

    def broadcast(self, obj):
        text = json.dumps(obj, separators=(",", ":"))
        for w in list(self.writers):
            try:
                self._write_text(w, text)
            except (ConnectionError, RuntimeError):
                self.writers.discard(w)

    def send(self, packets, addr):
        for p in packets:
            try:
                self.sock.sendto(p, addr)
            except OSError:
                pass

    def handle(self, text: str, writer=None):
        """One message from a page. Malformed ones are dropped instead of ending the connection."""
        try:
            msg = json.loads(text)
            if isinstance(msg, dict):
                self._handle(msg, text, writer)
        except (ValueError, TypeError, KeyError, IndexError, AttributeError, struct.error, OverflowError):
            pass

    def _handle(self, msg: dict, text: str, writer):
        kind = msg.get("type", "frame")
        if kind == "hello" and msg.get("role") == "viewer" and writer is not None:
            self.viewers.add(writer)  # an OBS browser-source page that only shows the avatar
            print("OBS用ビューアがつながりました", flush=True)
            return
        if kind == "frame":
            self.frames += 1
            for w in list(self.viewers):  # pass the pose on to the viewers as it is
                if w is not writer:
                    try:
                        self._write_text(w, text)
                    except (ConnectionError, RuntimeError):
                        self.viewers.discard(w)
            if self.vmc:
                self.send(vmc_packets(msg), self.vmc)
            if self.vrc:
                self.send(vrchat_packets(msg), self.vrc)
        elif kind == "chat" and self.vrc:
            # VRChat's chatbox limit; control characters (other than line breaks) are dropped
            text = re.sub(r"[\x00-\x09\x0b-\x1f\x7f]", "", str(msg.get("text", "")))[:144]
            self.send([osc_message("/chatbox/input", text, True, bool(msg.get("sound", True)))], self.vrc)
        elif kind == "typing" and self.vrc:
            self.send([osc_message("/chatbox/typing", bool(msg.get("on")))], self.vrc)
        elif kind == "param" and self.vrc:
            # an avatar parameter (e.g. the avatar's expression number); only plain names are accepted
            name, value = str(msg.get("name", "")), msg.get("value")
            if re.fullmatch(r"[A-Za-z0-9_/\-]{1,64}", name) and isinstance(value, (int, float, bool)):
                if not isinstance(value, bool):
                    value = value if isinstance(value, int) else float(value)  # whole numbers go as int, others as float
                self.send([osc_message("/avatar/parameters/" + name, value)], self.vrc)
        elif kind == "jump" and self.vrc:
            self.send([osc_message("/input/Jump", 1)], self.vrc)
            asyncio.get_running_loop().call_later(0.15, lambda: self.send([osc_message("/input/Jump", 0)], self.vrc))

    async def client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError):
            writer.close(); return
        lines = head.decode("latin-1").split("\r\n")
        hdr = {k.strip().lower(): v.strip() for k, _, v in (l.partition(":") for l in lines[1:] if ":" in l)}
        origin = hdr.get("origin", "")
        path = lines[0].split(" ")[1] if lines[0].count(" ") >= 2 else "/"
        allowed, reason = self.check_access(origin, path)
        if hdr.get("upgrade", "").lower() != "websocket" or "sec-websocket-key" not in hdr:
            allowed, reason = False, "WebSocket ではない接続"
        elif allowed and self.clients >= MAX_CLIENTS:
            allowed, reason = False, f"同時に接続できるのは {MAX_CLIENTS} 個までです"
        if not allowed:
            print(f"接続を拒否しました（{reason}）", flush=True)
            writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"); await writer.drain(); writer.close(); return
        accept = base64.b64encode(hashlib.sha1((hdr["sec-websocket-key"] + WS_GUID).encode()).digest()).decode()
        writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
        self.clients += 1
        self.writers.add(writer)
        print(f"Web版がつながりました（{origin}）", flush=True)
        await self._send_text(writer, json.dumps({"type": "hello", "vmc": _fmt(self.vmc), "vrchat": _fmt(self.vrc), "vmcIn": self.args.vmc_in or None}))
        buf = b""
        try:
            while True:
                b0, b1 = await reader.readexactly(2)
                op, masked, n = b0 & 0x0F, b1 & 0x80, b1 & 0x7F
                if n == 126:
                    n = struct.unpack(">H", await reader.readexactly(2))[0]
                elif n == 127:
                    n = struct.unpack(">Q", await reader.readexactly(8))[0]
                if n > MAX_MESSAGE or not masked:
                    break  # too big, or not from a browser (browsers always mask what they send)
                mask = await reader.readexactly(4)
                data = _unmask(await reader.readexactly(n), mask)
                if op == 8:
                    break
                if op == 9:  # ping -> pong
                    if n <= 125:
                        writer.write(bytes([0x8A, n]) + data); await writer.drain()
                    continue
                if op in (0, 1):
                    if len(buf) + len(data) > MAX_MESSAGE:
                        break  # a message split into pieces may not grow past the limit either
                    buf += data
                    if b0 & 0x80:  # final fragment
                        self.handle(buf.decode("utf-8", "replace"), writer); buf = b""
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            self.clients -= 1
            self.writers.discard(writer)
            self.viewers.discard(writer)
            print("Web版との接続が切れました", flush=True)
            writer.close()

    @staticmethod
    def _write_text(writer, text: str):
        data = text.encode()
        if len(data) < 126:
            hdr = bytes([0x81, len(data)])
        elif len(data) < 65536:
            hdr = bytes([0x81, 126]) + struct.pack(">H", len(data))
        else:
            hdr = bytes([0x81, 127]) + struct.pack(">Q", len(data))
        writer.write(hdr + data)

    async def _send_text(self, writer, text: str):
        self._write_text(writer, text); await writer.drain()

    async def stats(self):
        while True:
            await asyncio.sleep(3)
            if self.clients:
                msg = f"Web版から {self.frames / 3:.0f} 回/秒"
                if self.vmc_in_frames:
                    msg += f" ／ VMC受信 → Web版へ {self.vmc_in_frames / 3:.0f} 回/秒"
                print(msg, flush=True)
            self.frames = 0
            self.vmc_in_frames = 0


def _unmask(data: bytes, mask: bytes) -> bytes:
    # XOR the whole payload at once (byte by byte in Python is slow for big messages)
    n = len(data)
    key = int.from_bytes((mask * (n // 4 + 1))[:n], "big")
    return (int.from_bytes(data, "big") ^ key).to_bytes(n, "big") if n else b""


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
    print(f"  ファイルから開いたページ用の接続コード: {format_code(br.code)}（公開版・localhost なら入力不要）", flush=True)
    if args.vmc_in:
        loop = asyncio.get_running_loop()
        try:
            await loop.create_datagram_endpoint(lambda: VMCIn(br), local_addr=("0.0.0.0" if args.vmc_in_lan else "127.0.0.1", args.vmc_in))
            print(f"  VMC 受信: ポート {args.vmc_in}（{'LANからも' if args.vmc_in_lan else 'このPCの中だけ'}）", flush=True)
        except OSError as e:
            print(f"  VMC 受信ポート {args.vmc_in} を開けませんでした（ほかのアプリが使用中？）: {e}", flush=True)
    async with server:
        await asyncio.gather(server.serve_forever(), br.stats())


def main():
    ap = argparse.ArgumentParser(description="Mirror Mocap bridge (web -> VMC / VRChat OSC)")
    ap.add_argument("--ws-port", type=int, default=39541, help="port the web page connects to")
    ap.add_argument("--vmc", default="127.0.0.1:39539", help="VMC receiver host:port (VSeeFace etc.)")
    ap.add_argument("--vrchat", default="127.0.0.1:9000", help="VRChat OSC host:port")
    ap.add_argument("--no-vmc", action="store_true")
    ap.add_argument("--no-vrchat", action="store_true")
    ap.add_argument("--vmc-in", type=int, default=39542, help="UDP port to receive VMC motion on (0 = off)")
    ap.add_argument("--vmc-in-lan", action="store_true", help="accept VMC from other devices on the LAN (phones etc.)")
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
