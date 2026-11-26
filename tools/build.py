#!/usr/bin/env python3
"""Assemble index.html from src/.

src/index.html is the page skeleton. Every line of the form
    <!-- @include path -->
is replaced by the contents of src/<path>, and @SCRIPT_HASHES@ in the page's
Content-Security-Policy by the fingerprints of its inline scripts. The result is one self-contained
index.html, so the page still opens by double-clicking the file (a page opened
from file:// cannot load other script files).

    python tools/build.py           write index.html
    python tools/build.py --check   only check that index.html is up to date (exit 1 if not), and that the
                                    library fingerprints (SRI) in the import map match the files in
                                    tools/webtest/node_modules (the same versions the page loads)
    python tools/build.py --sri     print the fingerprints to paste into the import map after a version change

Edit the files in src/, never index.html directly: it is overwritten on build.
"""
import base64
import hashlib
import json
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


NODE_MODULES = ROOT / 'tools' / 'webtest' / 'node_modules'
NPM_URL = re.compile(r'^https://cdn\.jsdelivr\.net/npm/((?:@[^/]+/)?[^@/]+)@([^/]+)/(.+)$')


def import_map() -> dict:
    m = re.search(r'<script type="importmap">(.*?)</script>', (SRC / 'index.html').read_text(encoding='utf-8'), re.S)
    return json.loads(m.group(1))


def sri(path: Path) -> str:
    return 'sha384-' + base64.b64encode(hashlib.sha384(path.read_bytes()).digest()).decode()


def local_copy(url: str):
    """URL on jsDelivr -> (file in node_modules, version wanted, version installed)."""
    m = NPM_URL.match(url)
    if not m:
        return None, None, None
    pkg, ver, rel = m.groups()
    try:
        installed = json.loads((NODE_MODULES / pkg / 'package.json').read_text(encoding='utf-8'))['version']
    except (OSError, ValueError, KeyError):
        installed = None
    return NODE_MODULES / pkg / rel, ver, installed


def check_sri() -> list:
    """Problems with the import map's fingerprints (empty list = all good)."""
    if not NODE_MODULES.exists():
        print('(SRI not checked: run  npm install  in tools/webtest first)')
        return []
    im, problems = import_map(), []
    integrity = im.get('integrity', {})
    for name, url in im.get('imports', {}).items():
        if not url.endswith('/') and url not in integrity:
            problems.append(f'no fingerprint for {url}')
    for url, want in integrity.items():
        f, ver, installed = local_copy(url)
        if f is None:
            problems.append(f'not a jsDelivr npm URL: {url}')
        elif installed != ver:
            problems.append(f'{url}: the page wants {ver}, tools/webtest has {installed} (change package.json and npm install)')
        elif not f.exists():
            problems.append(f'{url}: {f} not found')
        elif sri(f) != want:
            problems.append(f'{url}: fingerprint does not match the file (run  python tools/build.py --sri)')
    return problems


def print_sri():
    for url in import_map().get('integrity', {}):
        f, _, _ = local_copy(url)
        print(f'    "{url}": "{sri(f) if f and f.exists() else "?"}",')


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
    if '--sri' in sys.argv:
        print_sri()
        return 0
    html = build()
    current = OUT.read_text(encoding='utf-8') if OUT.exists() else None
    if '--check' in sys.argv:
        ok = True
        if html != current:
            print('index.html is out of date: run  python tools/build.py'); ok = False
        else:
            print('index.html is up to date')
        for p in check_sri():
            print('SRI:', p); ok = False
        return 0 if ok else 1
    if html != current:
        OUT.write_text(html, encoding='utf-8', newline='\n')
        print(f'wrote {OUT.name} ({html.count(chr(10))} lines)')
    else:
        print('index.html already up to date')
    return 0


if __name__ == '__main__':
    sys.exit(main())
