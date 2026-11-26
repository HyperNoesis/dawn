#!/usr/bin/env python3
import sys, os
from PIL import Image, ImageChops
a, b = sys.argv[1], sys.argv[2]; bad = 0; n = 0
for f in sorted(os.listdir(a)):
    if not f.endswith('.png') or not os.path.exists(os.path.join(b, f)): continue
    x, y = Image.open(os.path.join(a, f)).convert('RGB'), Image.open(os.path.join(b, f)).convert('RGB'); n += 1
    if x.size != y.size: print('SIZE', f, x.size, y.size); bad += 1; continue
    d = ImageChops.difference(x, y); bb = d.getbbox()
    if bb:
        px = sum(1 for p in d.convert('L').getdata() if p > 8); 
        if px > 60: print('DIFF', f, px, 'px', bb); bad += 1
print('compared', n, 'different', bad); sys.exit(1 if bad else 0)
