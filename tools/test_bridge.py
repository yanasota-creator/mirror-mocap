#!/usr/bin/env python3
"""Tests for native/bridge/bridge.py (standard library only).

    python3 tools/test_bridge.py

Starts the bridge's WebSocket server on a free port and connects to it like a browser would,
with different page origins, connection codes and broken messages. OSC output goes to a local UDP socket.
"""
import argparse
import asyncio
import base64
import json
import os
import socket
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "native" / "bridge"))
import bridge as B  # noqa: E402

CODE = "ABCD2345"


def make_args(**kw):
    a = argparse.Namespace(ws_port=0, vmc="127.0.0.1:1", vrchat="127.0.0.1:1", no_vmc=False, no_vrchat=False,
                           vmc_in=0, vmc_in_lan=False, allow_origin=list(B.DEFAULT_ORIGINS), code=CODE)
    for k, v in kw.items():
        setattr(a, k, v)
    return a


class Client:
    """A tiny WebSocket client that masks its frames, as browsers do."""

    def __init__(self, reader, writer):
        self.r, self.w = reader, writer

    @classmethod
    async def connect(cls, port, origin, path="/"):
        r, w = await asyncio.open_connection("127.0.0.1", port)
        key = base64.b64encode(os.urandom(16)).decode()
        w.write((f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                 f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: {origin}\r\n\r\n").encode())
        await w.drain()
        head = await asyncio.wait_for(r.readuntil(b"\r\n\r\n"), 5)
        status = int(head.split(b" ")[1])
        return status, cls(r, w)

    def send_raw(self, payload: bytes, op=1, fin=True, masked=True):
        n = len(payload)
        b0 = (0x80 if fin else 0) | op
        if n < 126:
            hdr = bytes([b0, (0x80 if masked else 0) | n])
        elif n < 65536:
            hdr = bytes([b0, (0x80 if masked else 0) | 126]) + struct.pack(">H", n)
        else:
            hdr = bytes([b0, (0x80 if masked else 0) | 127]) + struct.pack(">Q", n)
        if masked:
            mask = os.urandom(4)
            payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
            hdr += mask
        self.w.write(hdr + payload)

    async def send(self, obj):
        self.send_raw(json.dumps(obj).encode() if not isinstance(obj, (bytes, str)) else (obj.encode() if isinstance(obj, str) else obj))
        await self.w.drain()

    async def recv(self, timeout=2):
        b0, b1 = await asyncio.wait_for(self.r.readexactly(2), timeout)
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack(">H", await self.r.readexactly(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", await self.r.readexactly(8))[0]
        return b0 & 0x0F, await self.r.readexactly(n)

    async def closed(self, timeout=2):
        try:
            return await asyncio.wait_for(self.r.read(1), timeout) == b""
        except ConnectionError:  # a reset is a close too
            return True
        except asyncio.TimeoutError:
            return False

    def close(self):
        self.w.close()


class BridgeTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.udp.bind(("127.0.0.1", 0)); self.udp.setblocking(False)
        port = self.udp.getsockname()[1]
        self.br = B.Bridge(make_args(vmc=f"127.0.0.1:{port}", vrchat=f"127.0.0.1:{port}"))
        self.server = await asyncio.start_server(self.br.client, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        self.server.close(); await self.server.wait_closed(); self.udp.close()

    def udp_messages(self):
        out = []
        while True:
            try:
                out += B.osc_parse(self.udp.recv(65536))
            except BlockingIOError:
                return out

    async def open(self, origin="https://yanasota-creator.github.io", path="/"):
        status, c = await Client.connect(self.port, origin, path)
        self.assertEqual(status, 101, origin)
        op, data = await c.recv()  # the bridge greets with its settings
        self.assertEqual(json.loads(data)["type"], "hello")
        return c

    # ---------------------------------------------------------------- who may connect
    async def test_allowed_origins_connect(self):
        for origin in ["https://yanasota-creator.github.io", "http://localhost:8000", "http://127.0.0.1:5500"]:
            (await self.open(origin)).close()

    async def test_other_sites_are_refused(self):
        for origin in ["https://evil.example", "http://localhost.evil.example", "https://yanasota-creator.github.io.evil.example", ""]:
            status, c = await Client.connect(self.port, origin)
            self.assertEqual(status, 403, origin); c.close()

    async def test_file_pages_need_the_code(self):
        # "null" is also what a sandboxed frame on any website sends, so it may not connect without the code
        status, c = await Client.connect(self.port, "null"); c.close()
        self.assertEqual(status, 403)
        status, c = await Client.connect(self.port, "null", "/?code=WRONG234"); c.close()
        self.assertEqual(status, 403)
        (await self.open("null", "/?code=abcd-2345")).close()  # case and the hyphen don't matter

    async def test_wrong_codes_lock_file_pages_for_a_while(self):
        for _ in range(5):
            status, c = await Client.connect(self.port, "null", "/?code=ZZZZZZZZ"); c.close()
        status, c = await Client.connect(self.port, "null", f"/?code={CODE}"); c.close()
        self.assertEqual(status, 403)
        # pages with a real origin are not affected
        (await self.open()).close()

    async def test_code_file_is_made_once_and_kept(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "bridge-code.txt"
            a = B.load_code(p)
            self.assertEqual(len(a), 8)
            self.assertTrue(all(ch in B.CODE_CHARS for ch in a))
            self.assertEqual(B.load_code(p), a)

    # ---------------------------------------------------------------- messages
    async def test_frame_and_chat_reach_osc(self):
        c = await self.open()
        await c.send({"type": "frame", "bones": {"hips": [0, 0, 0, 1]}, "pos": {"hips": [0, 1, 0]}, "blend": {"aa": 0.5},
                      "trackers": {"hips": {"p": [0, 1, 0], "q": [0, 0, 0, 1]}}})
        await c.send({"type": "chat", "text": "こんにちは\x07\x1b[31m"})
        await asyncio.sleep(0.2)
        msgs = self.udp_messages(); c.close()
        addrs = [a for a, _ in msgs]
        self.assertIn("/VMC/Ext/Bone/Pos", addrs)
        self.assertIn("/tracking/trackers/1/position", addrs)
        chat = [args for a, args in msgs if a == "/chatbox/input"][0]
        self.assertEqual(chat[0], "こんにちは[31m")  # control characters are dropped

    async def test_broken_messages_do_not_end_the_connection(self):
        c = await self.open()
        for bad in ["not json", "[1,2,3]", "null", {"type": "frame", "bones": "x"}, {"type": "frame", "bones": {"hips": ["a"]}},
                    {"type": "frame", "trackers": {"hips": {"p": None}}}, {"type": "param", "name": "../x", "value": 1},
                    {"type": "param", "name": "ok", "value": "str"}, {"type": "frame", "pos": [1], "bones": {"hips": [0, 0, 0, 1]}}]:
            await c.send(bad)
        await c.send({"type": "chat", "text": "still here"})
        await asyncio.sleep(0.2)
        self.assertIn(["still here", True, True], [args for a, args in self.udp_messages() if a == "/chatbox/input"])
        self.assertNotIn("/avatar/parameters/../x", [a for a, _ in self.udp_messages()])
        c.close()

    async def test_unmasked_and_oversized_frames_close_the_connection(self):
        c = await self.open()
        c.send_raw(b'{"type":"chat","text":"x"}', masked=False); await c.w.drain()
        self.assertTrue(await c.closed()); c.close()
        c = await self.open()
        # a message split into pieces may not grow past the limit either
        piece = b"x" * 60000
        for _ in range(B.MAX_MESSAGE // len(piece) + 2):
            c.send_raw(piece, op=1 if _ == 0 else 0, fin=False)
        await c.w.drain()
        self.assertTrue(await c.closed(5)); c.close()

    async def test_viewer_gets_the_senders_frames(self):
        viewer = await self.open(); await viewer.send({"type": "hello", "role": "viewer"})
        sender = await self.open()
        await asyncio.sleep(0.1)
        await sender.send({"type": "frame", "bones": {"hips": [0, 0, 0, 1]}})
        op, data = await viewer.recv()
        self.assertEqual(json.loads(data)["type"], "frame")
        viewer.close(); sender.close()

    async def test_too_many_clients_are_refused(self):
        cs = [await self.open() for _ in range(B.MAX_CLIENTS)]
        status, extra = await Client.connect(self.port, "https://yanasota-creator.github.io")
        self.assertEqual(status, 403)
        for c in cs + [extra]:
            c.close()


class VMCInTest(unittest.TestCase):
    def setUp(self):
        self.sent = []
        br = argparse.Namespace(broadcast=self.sent.append, vmc_in_frames=0)
        self.v = B.VMCIn(br)

    def test_bones_and_blend_are_read_and_clamped(self):
        pkt = B.osc_bundle([B.osc_message("/VMC/Ext/Bone/Pos", "Hips", 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0),
                            B.osc_message("/VMC/Ext/Blend/Val", "Joy", 3.0)])
        self.v.datagram_received(pkt, None)
        self.assertEqual(self.v.bones["Hips"][1], 1.0)
        self.assertEqual(self.v.blend["Joy"], 1.0)

    def test_nan_and_huge_counts_are_ignored(self):
        self.v.datagram_received(B.osc_message("/VMC/Ext/Bone/Pos", "Hips", float("nan"), 0.0, 0.0, 0.0, 0.0, 0.0, 1.0), None)
        self.assertNotIn("Hips", self.v.bones)
        for i in range(500):
            self.v.datagram_received(B.osc_message("/VMC/Ext/Blend/Val", f"x{i}", 0.5), None)
        self.assertLessEqual(len(self.v.blend), B.VMCIn.MAX_BLEND)
        self.v.datagram_received(B.osc_message("/VMC/Ext/Blend/Val", "y" * 500, 0.5), None)
        self.assertNotIn("y" * 500, self.v.blend)

    def test_broken_and_deeply_nested_packets_are_dropped(self):
        for bad in [b"", b"\xff\xfe", b"#bundle\0" + b"\0" * 8 + struct.pack(">i", 1000), b"#bundle\0" + b"\0" * 8 + struct.pack(">i", -4)]:
            self.v.datagram_received(bad, None)
        nested = B.osc_message("/VMC/Ext/Blend/Val", "Joy", 0.5)
        for _ in range(50):
            nested = B.osc_bundle([nested])
        self.v.datagram_received(nested, None)
        self.assertNotIn("Joy", self.v.blend)

    def test_osc_round_trip(self):
        m = B.osc_message("/a/b", 1, 2.5, "テキスト", True, False)
        self.assertEqual(B.osc_parse(m), [("/a/b", [1, 2.5, "テキスト", True, False])])

    def test_unmask(self):
        data, mask = os.urandom(1001), os.urandom(4)
        self.assertEqual(B._unmask(data, mask), bytes(c ^ mask[i % 4] for i, c in enumerate(data)))
        self.assertEqual(B._unmask(b"", mask), b"")


if __name__ == "__main__":
    unittest.main(verbosity=2)
