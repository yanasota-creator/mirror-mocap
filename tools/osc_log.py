"""Print OSC messages that arrive on a UDP port (stand-in for VRChat / VSeeFace when testing bridge.py).
    python tools/osc_log.py native/bridge 30 [port]   # listen for 30 s (port 9000 by default)
"""
import socket, struct, sys, time
sys.path.insert(0, sys.argv[1]); from bridge import osc_parse
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(("127.0.0.1", int(sys.argv[3]) if len(sys.argv) > 3 else 9000)); s.settimeout(0.5); end = time.time() + float(sys.argv[2])
while time.time() < end:
    try: b, _ = s.recvfrom(65536)
    except socket.timeout: continue
    for a, args in osc_parse(b):
        print(a, args, flush=True)
