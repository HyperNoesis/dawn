import cv2, numpy as np, glob, os, sys
D="/home/claude/jizhizili/p3m/demo/imgs"; OUT=sys.argv[1]; W,H,N,FPS=640,360,90,15
rng=np.random.default_rng(7)
stems=[os.path.basename(f)[:-4] for f in sorted(glob.glob(D+"/alpha/*.png")) if "p_71bcce3a" not in f][:8]
def bg(kind,t,mean_fg):
    y,x=np.mgrid[0:H,0:W].astype(np.float32)
    ph=t*0.15
    base=np.stack([128+90*np.sin(x/90+ph),128+90*np.sin(y/60+ph*1.3),128+90*np.sin((x+y)/120-ph)],-1)
    if kind=="similar": base=0.35*base+0.65*np.array(mean_fg,np.float32)      # background drifts toward the subject's own colours
    if kind=="backlit": base=np.clip(base*0.5+170,0,255)
    return np.clip(base,0,255)
CLIPS=[("sway","normal"),("fast","normal"),("lowlight","normal"),("backlit","backlit"),("similar","similar"),("zoom","normal"),("sway2","normal"),("fast2","backlit")]
for ci,(name,bk) in enumerate(CLIPS):
    s=stems[ci]; im=cv2.imread(f"{D}/original/{s}.jpg").astype(np.float32); a=cv2.imread(f"{D}/alpha/{s}.png",0).astype(np.float32)/255
    sc=H*1.0/im.shape[0]; im=cv2.resize(im,None,fx=sc,fy=sc,interpolation=cv2.INTER_AREA); a=cv2.resize(a,(im.shape[1],im.shape[0]),interpolation=cv2.INTER_AREA)
    mean_fg=(im*a[...,None]).sum((0,1))/max(1e-3,a.sum())
    frames=np.zeros((N,H,W,3),np.uint8); alphas=np.zeros((N,H,W),np.uint8)
    for f in range(N):
        sub=[]
        nsub=3 if name.startswith("fast") else 1
        acc_i=np.zeros((H,W,3),np.float32); acc_a=np.zeros((H,W),np.float32)
        for k in range(nsub):
            t=(f+k/nsub)/FPS
            amp=70 if name.startswith("fast") else 35; fr=1.6 if name.startswith("fast") else 0.7
            dx=amp*np.sin(2*np.pi*fr*t*0.5); dy=6*np.sin(2*np.pi*0.9*t); z=1+(0.18*np.sin(2*np.pi*0.25*t) if name=="zoom" else 0.05*np.sin(2*np.pi*0.4*t)); rot=4*np.sin(2*np.pi*0.5*t)
            cx,cy=im.shape[1]/2,im.shape[0]/2
            M=cv2.getRotationMatrix2D((cx,cy),rot,z); M[0,2]+=W/2-cx+dx; M[1,2]+=H/2-cy+dy
            wi=cv2.warpAffine(im,M,(W,H),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT); wa=cv2.warpAffine(a,M,(W,H),flags=cv2.INTER_LINEAR)
            if bk=="backlit": wi=wi*0.62
            b=bg(bk,t,mean_fg); acc_i+=wi*wa[...,None]+b*(1-wa[...,None]); acc_a+=wa
        comp=acc_i/nsub; al=acc_a/nsub
        if name=="lowlight": comp=(comp/255)**1.9*255*0.55; comp=comp+rng.normal(0,7,comp.shape)
        comp=comp+rng.normal(0,1.2,comp.shape)
        frames[f]=np.clip(comp,0,255).astype(np.uint8); alphas[f]=np.clip(al*255+.5,0,255).astype(np.uint8)
    np.save(f"{OUT}/{name}_rgb.npy",frames); np.save(f"{OUT}/{name}_alpha.npy",alphas); print(name,s,frames.shape,round(alphas.mean()/255*100,1),"% fg")
