import cv2, numpy as np, onnxruntime as ort, json, sys, time, os
M, C, OUT = sys.argv[1], sys.argv[2], sys.argv[3]; NF = int(sys.argv[4]) if len(sys.argv)>4 else 45
so = ort.SessionOptions(); so.log_severity_level = 3; so.intra_op_num_threads = 2
S = lambda f: ort.InferenceSession(os.path.join(M, f), so, providers=["CPUExecutionProvider"])
pp, mn, rv = S("ppmatting_v2.onnx"), S("modnet.onnx"), S("rvm_mobilenetv3_fp32.onnx")
def dims(h, w, edge, mult):
    s = edge / max(h, w); return max(32, int(w*s)//mult*mult), max(32, int(h*s)//mult*mult)
def chw(rgb, m, sd): return np.ascontiguousarray(((rgb.astype(np.float32)/255 - m)/sd).transpose(2,0,1)[None])
def f_pp(bgr, edge, st):
    h,w = bgr.shape[:2]; tw,th = dims(h,w,edge,32); rgb = cv2.cvtColor(cv2.resize(bgr,(tw,th),interpolation=cv2.INTER_LINEAR),cv2.COLOR_BGR2RGB)
    return cv2.resize(pp.run(None,{"img":chw(rgb,.5,.5)})[0][0,0],(w,h))
def f_mn(bgr, edge, st):
    h,w = bgr.shape[:2]; tw,th = dims(h,w,edge,32); rgb = cv2.cvtColor(cv2.resize(bgr,(tw,th),interpolation=cv2.INTER_AREA),cv2.COLOR_BGR2RGB)
    return cv2.resize(mn.run(None,{"input":chw(rgb,.5,.5)})[0][0,0],(w,h))
def f_rv(bgr, edge, st):
    h,w = bgr.shape[:2]; tw,th = dims(h,w,edge,4); rgb = cv2.cvtColor(cv2.resize(bgr,(tw,th),interpolation=cv2.INTER_AREA),cv2.COLOR_BGR2RGB)
    z = np.zeros((1,1,1,1),np.float32); r = st.get("r") or [z,z,z,z]
    o = rv.run(None,{"src":chw(rgb,0,1),"r1i":r[0],"r2i":r[1],"r3i":r[2],"r4i":r[3],"downsample_ratio":np.array([1.0],np.float32)})
    st["r"] = o[2:6]; return cv2.resize(o[1][0,0],(w,h))
CFG = [("modnet@384",f_mn,384),("modnet@512",f_mn,512),("rvm@384(recurrent)",f_rv,384),("pp-v2@384",f_pp,384),("pp-v2@512",f_pp,512)]
res = {}
for clip in ["sway","fast","lowlight","backlit","similar","zoom","sway2","fast2"]:
    rgb = np.load(f"{C}/{clip}_rgb.npy")[:NF]; gt = np.load(f"{C}/{clip}_alpha.npy")[:NF]
    for name,fn,edge in CFG:
        st = {}; preds=[]; ms=[]
        for f in range(NF):
            bgr = cv2.cvtColor(rgb[f],cv2.COLOR_RGB2BGR) if False else rgb[f][:,:,::-1].copy()
            t=time.time(); a=fn(bgr,edge,st); ms.append((time.time()-t)*1000); preds.append(np.clip(a*255+.5,0,255).astype(np.uint8))
        P=np.array(preds).astype(np.float32)/255; G=gt.astype(np.float32)/255
        d=np.abs(P-G); mad=d.mean()*1000
        soft=(G>.05)&(G<.95); band=np.stack([cv2.dilate(((g>.02)&(g<.98)|(cv2.morphologyEx((g>.5).astype(np.uint8),cv2.MORPH_GRADIENT,np.ones((3,3),np.uint8))>0)).astype(np.uint8),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(25,25)))>0 for g in G])
        dd=((P[1:]-P[:-1])-(G[1:]-G[:-1])); dtssd=float(np.sqrt((dd**2).mean())*100)
        flick=float(np.abs(P[1:]-P[:-1])[~band[1:]&~band[:-1]].mean()*100) if (~band[1:]&~band[:-1]).any() else 0   # change away from the subject edge: pure instability
        res.setdefault(clip,{})[name]=dict(mad=round(float(mad),2),edge=round(float(d[band].mean()*1000),1),soft=round(float(d[soft].mean()*1000),1),dtssd=round(dtssd,3),flick_bg=round(flick,4),ms=round(float(np.median(ms)),0),worst=round(float(d.reshape(NF,-1).mean(1).max()*1000),1))
        print(clip,name,res[clip][name],flush=True)
    json.dump(res,open(OUT,"w"),indent=1)
