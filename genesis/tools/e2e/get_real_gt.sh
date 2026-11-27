#!/bin/sh
# Prepares the real-portrait ground-truth set for t63/t64: 12 photos with HUMAN-ANNOTATED alpha from JizhiziLi/P3M (demo images; faces blurred).
# LICENCE: P3M is research / NON-COMMERCIAL. TEST ONLY: never copy these files into the app, the site build or a release.
# Usage: sh tools/e2e/get_real_gt.sh [outdir=/tmp/realgt] ; then REAL_GT=<outdir> node tools/e2e/t63_real_gt_bench.js ; PRED_DIR=pred python3 tools/matte-bench/score_real_gt.py <outdir>
set -e
OUT="${1:-/tmp/realgt}"; mkdir -p "$OUT"
[ -d "$OUT/p3m" ] || git clone -q --depth 1 https://github.com/JizhiziLi/P3M.git "$OUT/p3m"
python3 - "$OUT" <<'PY'
import sys, os, glob
from PIL import Image
out = sys.argv[1]; src = out + '/p3m/demo/imgs'
os.makedirs(out + '/frames', exist_ok=True); os.makedirs(out + '/gt', exist_ok=True)
for f in sorted(glob.glob(src + '/original/*.jpg')):
    i = os.path.basename(f)[:-4]; im = Image.open(f).convert('RGB'); a = Image.open(f"{src}/alpha/{i}.png").convert('L')
    s = 1280 / max(im.size); sz = (round(im.width * s), round(im.height * s)) if s < 1 else im.size
    im.resize(sz, Image.LANCZOS).save(f'{out}/frames/{i}.jpg', quality=95); a.resize(sz, Image.LANCZOS).save(f'{out}/gt/{i}.png')
print('prepared', len(os.listdir(out + '/frames')), 'frames + GT in', out)
PY
