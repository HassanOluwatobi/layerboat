"""Compares After Effects renders of the saved designs with Figma's own
exports. Fails when any design gets noticeably worse than its baseline.

    python3 tests/regress.py <dev folder> [--update-baseline]
"""
import json, os, sys
from PIL import Image
import numpy as np

dev = sys.argv[1]
fx, out = os.path.join(dev, 'fixtures'), os.path.join(dev, 'fixtures-out')
base_path = os.path.join(fx, 'baseline.json')
baseline = json.load(open(base_path)) if os.path.exists(base_path) else {}
timing = {}
if os.path.exists(os.path.join(out, 'report.txt')):
    for line in open(os.path.join(out, 'report.txt')):
        p = line.rstrip('\n').split('\t')
        timing[p[0]] = p[1:]
failed, now = False, {}
print('%-18s %8s %9s %8s  %s' % ('design', 'diff', 'baseline', 'time', 'result'))
for f in sorted(os.listdir(fx)):
    if not f.endswith('.json') or f == 'baseline.json':
        continue
    name = f[:-5]
    ref, got = os.path.join(fx, name + '.png'), os.path.join(out, name + '.png')
    if not os.path.exists(got):
        print('%-18s %8s %9s %8s  FAIL (not built: %s)' % (name, '-', '-', '-', ' '.join(timing.get(name, []))))
        failed = True
        continue
    a = np.asarray(Image.open(ref).convert('RGB')).astype(int)
    b = np.asarray(Image.open(got).convert('RGB')).astype(int)
    if a.shape != b.shape:
        print('%-18s size differs %s vs %s  FAIL' % (name, a.shape, b.shape))
        failed = True
        continue
    d = float(np.abs(a - b).mean())
    now[name] = round(d, 3)
    allowed = baseline.get(name, d) + 0.3
    ok = d <= allowed
    failed = failed or not ok
    print('%-18s %8.2f %9s %8s  %s' % (name, d, baseline.get(name, '-'), (timing.get(name) or ['-'])[0], 'ok' if ok else 'WORSE'))
if '--update-baseline' in sys.argv:
    json.dump(now, open(base_path, 'w'), indent=1)
    print('baseline saved')
print('FAILED' if failed else 'ALL OK')
sys.exit(1 if failed else 0)
