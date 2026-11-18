import cv2, numpy as np, glob, os, json, sys
out, gtd, imd = sys.argv[1:4]
engs = ["modnet","rvm","ppmatting-v2","ppmatting-hrnet"]
rep = json.load(open(out+"/compare_report.json"))["images"]
rows = {e:[] for e in engs}
def grad(a):
    a=a.astype(np.float32)/255
    return np.sqrt(cv2.Sobel(a,cv2.CV_32F,1,0)**2+cv2.Sobel(a,cv2.CV_32F,0,1)**2)
for stem in sorted(rep):
    gt = cv2.imread(f"{gtd}/{stem}.png",0)
    h,w = gt.shape
    # edge band: GT fractional pixels plus the gradient zone, dilated
    g = gt.astype(np.float32)/255
    frac = ((g>0.02)&(g<0.98)).astype(np.uint8)
    edge = cv2.morphologyEx(((g>0.5).astype(np.uint8)), cv2.MORPH_GRADIENT, np.ones((3,3),np.uint8))|frac
    band = cv2.dilate(edge, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(31,31)))>0
    for e in engs:
        p = cv2.imread(f"{out}/{stem}_{e}_alpha.png",0)
        if p.shape!=gt.shape: p=cv2.resize(p,(w,h))
        d = np.abs(p.astype(np.float32)-gt.astype(np.float32))/255
        ge = np.abs(grad(p)-grad(gt))
        rows[e].append(dict(stem=stem, mad=d.mean()*1000, mad_edge=d[band].mean()*1000, mad_outside=d[~band].mean()*1000,
                            grad=ge.sum()/1000, ms=rep[stem][e]["ms"], band_pct=band.mean()*100))
print(f"{'engine':18}{'MAD x1e3':>10}{'MAD edge':>10}{'MAD interior/bg':>17}{'grad err':>10}{'ms/img(CPU)':>13}")
for e in engs:
    r=rows[e]; m=lambda k: np.mean([x[k] for x in r])
    print(f"{e:18}{m('mad'):10.2f}{m('mad_edge'):10.2f}{m('mad_outside'):17.2f}{m('grad'):10.2f}{m('ms'):13.0f}")
print("\nper-image wins (lowest edge-band MAD / lowest overall MAD):")
for key in ("mad_edge","mad"):
    wins={e:0 for e in engs}
    for i in range(len(rows[engs[0]])):
        wins[min(engs,key=lambda e: rows[e][i][key])]+=1
    print(key,wins)
print("\nper image MAD (x1e3):")
print("stem        "+"".join(f"{e[:12]:>14}" for e in engs))
for i in range(len(rows[engs[0]])):
    print(rows[engs[0]][i]["stem"]+"  "+"".join(f"{rows[e][i]['mad']:14.1f}" for e in engs))
json.dump(rows,open(out+"/scored.json","w"),indent=1,default=float)
