#!/usr/bin/env python3
"""Assemble index.html from src/.

src/index.html is the page skeleton. Every line of the form
    <!-- @include path -->
is replaced by the contents of src/<path>, and @SCRIPT_HASHES@ in the page's
Content-Security-Policy by the fingerprints of its inline scripts. The result is one self-contained
index.html, so the page still opens by double-clicking the file (a page opened
from file:// cannot load other script files).

    python tools/build.py           write index.html
    python tools/build.py --check   only check that index.html is up to date (exit 1 if not)

Edit the files in src/, never index.html directly: it is overwritten on build.
"""
import base64
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
OUT = ROOT / 'index.html'
INCLUDE = re.compile(r'^<!-- @include (\S+) -->\n?$')
INLINE_SCRIPT = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', re.S)


def script_hashes(html: str) -> str:
    """CSP fingerprints of every script written in the page (the browser runs only scripts that match)."""
    return ' '.join("'sha256-" + base64.b64encode(hashlib.sha256(body.encode('utf-8')).digest()).decode() + "'"
                    for body in INLINE_SCRIPT.findall(html))


def build() -> str:
    out = []
    for line in (SRC / 'index.html').read_text(encoding='utf-8').splitlines(keepends=True):
        m = INCLUDE.match(line)
        if not m:
            out.append(line)
            continue
        part = (SRC / m.group(1)).read_text(encoding='utf-8')
        if part and not part.endswith('\n'):
            part += '\n'
        out.append(part)
    html = ''.join(out)
    if '@SCRIPT_HASHES@' in html:
        html = html.replace('@SCRIPT_HASHES@', script_hashes(html))
    return html


def main() -> int:
    html = build()
    current = OUT.read_text(encoding='utf-8') if OUT.exists() else None
    if '--check' in sys.argv:
        if html != current:
            print('index.html is out of date: run  python tools/build.py')
            return 1
        print('index.html is up to date')
        return 0
    if html != current:
        OUT.write_text(html, encoding='utf-8', newline='\n')
        print(f'wrote {OUT.name} ({html.count(chr(10))} lines)')
    else:
        print('index.html already up to date')
    return 0


if __name__ == '__main__':
    sys.exit(main())
