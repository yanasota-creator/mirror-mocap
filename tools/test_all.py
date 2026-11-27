#!/usr/bin/env python3
"""Run every check, in order, and print one summary line each.

    python3 tools/test_all.py            all checks (the browser test takes a few minutes)
    python3 tools/test_all.py --quick    skip the browser test
    python3 tools/test_all.py --cam cam.y4m   also check tracking from a fake camera video
    python3 tools/test_all.py --a11y     also run the accessibility check (axe; slow without a GPU)

1. index.html is built from src/ and the library fingerprints (SRI) match   (tools/build.py --check)
2. the page's script has no syntax errors and passes the code check         (node --check, ESLint)
3. the PC bridge                                                             (tools/test_bridge.py)
   and the Unity receiver compiles against small stand-ins for Unity / UniVRM  (tools/unity-stubs/check.sh, needs mcs)
4. the web page in a real browser                                            (tools/webtest/smoke.js)
5. accessibility, with --a11y                                                (tools/webtest/a11y.js)
6. the PC tracker on the --cam video, if mediapipe is installed              (tools/test_tracker.py)
"""
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable


def run(name, cmd, cwd=ROOT, timeout=900):
    print(f'--- {name}', flush=True)
    try:
        r = subprocess.run(cmd, cwd=cwd, timeout=timeout, capture_output=True, text=True, encoding='utf-8', errors='replace')
    except FileNotFoundError as e:
        print(f'    skipped ({e.filename} not found)'); return None
    except subprocess.TimeoutExpired:
        print('    timed out'); return False
    out = (r.stdout + r.stderr).strip().splitlines()
    for line in out[-25:] if r.returncode else out[-3:]:
        print('    ' + line)
    return r.returncode == 0


def syntax_check():
    """Pull the page's module script out of index.html and let Node parse it."""
    if not shutil.which('node'):
        return None
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    m = re.search(r'<script type="module">(.*?)</script>', html, re.S)
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / 'page.mjs'
        f.write_text(m.group(1), encoding='utf-8')
        ok = run('2. スクリプトの文法', ['node', '--check', str(f)])
    web = ROOT / 'tools' / 'webtest'
    if ok and (web / 'node_modules' / '.bin').exists():
        (web / 'page.lint.mjs').write_text(m.group(1), encoding='utf-8')
        try:
            ok = run('2. コード点検（ESLint）', ['node', str(web / 'node_modules' / 'eslint' / 'bin' / 'eslint.js'), 'page.lint.mjs'], cwd=web)
        finally:
            (web / 'page.lint.mjs').unlink(missing_ok=True)
    return ok


def main():
    args = sys.argv[1:]
    results = {
        '1. 組み立て・SRI': run('1. 組み立て・SRI', [PY, 'tools/build.py', '--check']),
        '2. 文法・コード点検': syntax_check(),
        '3. PCブリッジ': run('3. PCブリッジ', [PY, 'tools/test_bridge.py']),
        '3b. Unity（コンパイル）': run('3b. Unity（コンパイル）', ['bash', 'tools/unity-stubs/check.sh']) if shutil.which('mcs') and shutil.which('bash') else None,
    }
    if '--quick' not in args:
        web = ROOT / 'tools' / 'webtest'
        if not (web / 'node_modules').exists():
            print('--- 4. Web版（ブラウザ）\n    skipped (run  npm install  in tools/webtest first)')
            results['4. Web版（ブラウザ）'] = None
        else:
            cmd = ['node', 'smoke.js']
            if '--cam' in args:
                cmd.append(str(Path(args[args.index('--cam') + 1]).resolve()))
            results['4. Web版（ブラウザ）'] = run('4. Web版（ブラウザ）', cmd, cwd=web, timeout=1200)
            if '--a11y' in args:
                results['5. 使いやすさ（axe）'] = run('5. 使いやすさ（axe）', ['node', 'a11y.js'], cwd=web, timeout=1800)
    if '--cam' in args:
        has_mp = subprocess.run([PY, '-c', 'import mediapipe, cv2'], capture_output=True).returncode == 0
        results['6. PC版トラッカー'] = run('6. PC版トラッカー', [PY, 'tools/test_tracker.py', str(Path(args[args.index('--cam') + 1]).resolve())], timeout=600) if has_mp else None
    print()
    for k, v in results.items():
        print({True: '○', False: '×', None: '－'}[v], k, '' if v is not None else '（実行できなかったので省略）')
    return 0 if all(v is not False for v in results.values()) else 1


if __name__ == '__main__':
    sys.exit(main())
