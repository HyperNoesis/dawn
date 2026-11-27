#!/usr/bin/env python3
"""Score tools/e2e/t63_real_gt_bench.js output with the repository's own metrics (evaluate.alpha_metrics). Never resizes.
Usage: score_real_gt.py <REAL_GT dir> [out.json]. Strata per image: all pixels, uncertain band (GT 0.05-0.95: hair/edges), and foreground IoU."""
import sys, os, json, glob
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evaluate as E
root = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, 'scores.json')
PRED = os.environ.get('PRED_DIR', 'pred')
engs = sorted(os.listdir(os.path.join(root, PRED)))
res = {}
def rd(p): return cv2.imread(p, cv2.IMREAD_GRAYSCALE)
for e in engs:
    res[e] = {}
    for d in sorted(os.listdir(os.path.join(root, PRED, e))):
        rows = []
        for f in sorted(glob.glob(os.path.join(root, PRED, e, d, '*.png'))):
            i = os.path.basename(f)[:-4]; p = rd(f); g = rd(os.path.join(root, 'gt', i + '.png'))
            m = E.alpha_metrics(p, g)
            pu, gu = E.unit(p), E.unit(g); band = (gu > .05) & (gu < .95)
            fg_p, fg_g = pu > .5, gu > .5
            rows.append({'id': i, 'mae': m['mae'], 'grad': m['gradient_mae'], 'bf1': m['boundary_f1'], 'iou': float((fg_p & fg_g).sum() / max(1, (fg_p | fg_g).sum())),
                         'band_mae': float(np.abs(pu - gu)[band].mean()) if band.any() else None, 'fg_ratio_pred': float(fg_p.mean()), 'fg_ratio_gt': float(fg_g.mean())})
        mean = lambda k: float(np.mean([r[k] for r in rows if r[k] is not None]))
        res[e][d] = {'n': len(rows), 'mae_x1000': round(mean('mae') * 1000, 2), 'band_mae_x1000': round(mean('band_mae') * 1000, 1), 'boundary_f1': round(mean('bf1'), 3), 'iou': round(mean('iou'), 4),
                     'worst_image': max(rows, key=lambda r: r['mae'])['id'], 'worst_mae_x1000': round(max(r['mae'] for r in rows) * 1000, 1), 'per_image': rows}
json.dump(res, open(out, 'w'), indent=1)
hdr = ['engine'] + sorted({d for e in res for d in res[e]}); degs = hdr[1:]
print('MAE x1000 (lower is better), 12 real portraits, GT = human alpha'); print('%-20s' % 'engine', *['%10s' % d for d in degs])
for e in res: print('%-20s' % e, *['%10.2f' % res[e][d]['mae_x1000'] for d in degs])
print('\nUncertain-band (hair/edge) MAE x1000'); 
for e in res: print('%-20s' % e, *['%10.1f' % res[e][d]['band_mae_x1000'] for d in degs])
print('\nForeground IoU')
for e in res: print('%-20s' % e, *['%10.4f' % res[e][d]['iou'] for d in degs])
print('\nWorst image (clean): ', {e: (res[e]['clean']['worst_image'], res[e]['clean']['worst_mae_x1000']) for e in res})
