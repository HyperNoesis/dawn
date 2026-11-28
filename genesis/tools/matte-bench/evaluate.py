#!/usr/bin/env python3
"""Evaluate predicted alpha against independent, aligned ground truth. Never resize silently."""
import argparse,json
from pathlib import Path
import cv2,numpy as np
from scipy import ndimage
def unit(image):
 a=np.asarray(image,dtype=np.float32)
 if a.ndim!=2 or a.size==0 or not np.isfinite(a).all(): raise ValueError("alpha must be non-empty, single-channel and finite")
 return np.clip(a/(255.0 if a.max()>1 else 1.0),0,1)
def boundary(m): return m ^ ndimage.binary_erosion(m,structure=np.ones((3,3),bool),border_value=0)
def alpha_metrics(prediction,target,tolerance=2):
 p,g=unit(prediction),unit(target)
 if p.shape!=g.shape: raise ValueError(f"shape mismatch: {p.shape} vs {g.shape}")
 e=p-g;px,py=np.gradient(p);gx,gy=np.gradient(g);pb,gb=boundary(p>=.5),boundary(g>=.5)
 if not pb.any() and not gb.any(): precision=recall=1.
 elif not pb.any() or not gb.any(): precision=recall=0.
 else:
  st=np.ones((2*max(0,int(tolerance))+1,)*2,bool)
  precision=float((pb&ndimage.binary_dilation(gb,structure=st)).sum())/max(1,int(pb.sum()))
  recall=float((gb&ndimage.binary_dilation(pb,structure=st)).sum())/max(1,int(gb.sum()))
 f1=2*precision*recall/max(1e-12,precision+recall)
 return {"mae":float(np.abs(e).mean()),"mse":float((e*e).mean()),"sad_per_1000px":float(np.abs(e).sum()/1000),
 "gradient_mae":float((np.abs(px-gx).mean()+np.abs(py-gy).mean())/2),"boundary_precision":precision,
 "boundary_recall":recall,"boundary_f1":float(f1),
 "semi_transparent_pixel_count_prediction":int(((p>.05)&(p<.95)).sum()),
 "semi_transparent_pixel_count_target":int(((g>.05)&(g<.95)).sum())}
def sequence_metrics(records):
 groups={}
 for r in records:
  if r.get("sequence") is not None: groups.setdefault(str(r["sequence"]),[]).append(r)
 result={}
 for name,frames in groups.items():
  frames.sort(key=lambda r:int(r.get("frame",0)))
  if len(frames)<2: continue
  d=[];pf=[];tf=[]
  for a,b in zip(frames,frames[1:]):
   p0,p1=unit(a["prediction_array"]),unit(b["prediction_array"])
   t0,t1=unit(a["target_array"]),unit(b["target_array"])
   if p0.shape!=p1.shape or t0.shape!=t1.shape or p0.shape!=t0.shape: raise ValueError("sequence dimensions differ: "+name)
   dp,dt=p1-p0,t1-t0;d.append(np.abs(dp-dt).mean());pf.append(np.abs(dp).mean());tf.append(np.abs(dt).mean())
  result[name]={"temporal_delta_mae":float(np.mean(d)),"prediction_flicker":float(np.mean(pf)),"target_flicker":float(np.mean(tf))}
 return result
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument("manifest",type=Path);ap.add_argument("--output",type=Path)
 ap.add_argument("--boundary-tolerance",type=int,default=2);ap.add_argument("--require-commercial-clearance",action="store_true");args=ap.parse_args()
 root=args.manifest.resolve().parent;entries=[]
 for no,line in enumerate(args.manifest.read_text(encoding="utf-8").splitlines(),1):
  if not line.strip() or line.lstrip().startswith("#"): continue
  item=json.loads(line)
  for k in ("id","prediction","target","usage_rights","provenance"):
   if k not in item: raise ValueError(f"manifest line {no} missing {k}")
  if args.require_commercial_clearance and (item["usage_rights"]!="commercial-cleared" or not item.get("consent_or_lawful_basis")):
   raise ValueError(f"manifest line {no} lacks clearance declaration or lawful-basis record")
  p=cv2.imread(str(root/item["prediction"]),cv2.IMREAD_GRAYSCALE);g=cv2.imread(str(root/item["target"]),cv2.IMREAD_GRAYSCALE)
  if p is None or g is None: raise FileNotFoundError(f"cannot read pair on manifest line {no}")
  entries.append({"id":item["id"],"sequence":item.get("sequence"),"frame":item.get("frame"),"split":item.get("split"),
   "usage_rights":item["usage_rights"],"metrics":alpha_metrics(p,g,args.boundary_tolerance),"prediction_array":p,"target_array":g})
 if not entries: raise ValueError("manifest contains no frame pairs")
 names=list(entries[0]["metrics"]);aggregate={k:float(np.mean([e["metrics"][k] for e in entries])) for k in names}
 temporal=sequence_metrics(entries)
 for e in entries: e.pop("prediction_array");e.pop("target_array")
 report={"protocol":"Genesis independent-alpha-ground-truth evaluation v1","frame_count":len(entries),"aggregate_mean":aggregate,
 "sequences":temporal,"frames":entries,"warning":"Only meaningful for independent, aligned alpha ground truth with verified data rights."}
 encoded=json.dumps(report,indent=2,allow_nan=False)
 if args.output: args.output.write_text(encoded+"\n",encoding="utf-8")
 else: print(encoded)
if __name__=="__main__": main()
