#!/usr/bin/env python3
"""Assemble index.html from src/.

src/index.html is the page skeleton. Every line of the form
    <!-- @include path -->
is replaced by the contents of src/<path>. The result is one self-contained
index.html, so the page still opens by double-clicking the file (a page opened
from file:// cannot load other script files).

    python tools/build.py           write index.html
    python tools/build.py --check   only check that index.html is up to date (exit 1 if not)

Edit the files in src/, never index.html directly: it is overwritten on build.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
OUT = ROOT / 'index.html'
INCLUDE = re.compile(r'^<!-- @include (\S+) -->\n?$')


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
    return ''.join(out)


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
