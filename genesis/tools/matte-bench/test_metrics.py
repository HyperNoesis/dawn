#!/usr/bin/env python3
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import numpy as np
from evaluate import alpha_metrics,sequence_metrics
gt=np.zeros((24,32),np.uint8);gt[4:20,8:24]=255
m=alpha_metrics(gt,gt);assert m["mae"]==0 and m["mse"]==0 and m["boundary_f1"]==1
shift=np.zeros_like(gt);shift[4:20,9:25]=255
m=alpha_metrics(shift,gt,0);assert m["mae"]>0 and 0<m["boundary_f1"]<1
try: alpha_metrics(gt,np.zeros((12,12),np.uint8));raise AssertionError("shape mismatch should fail")
except ValueError: pass
r=sequence_metrics([{"sequence":"a","frame":0,"prediction_array":gt,"target_array":gt},{"sequence":"a","frame":1,"prediction_array":shift,"target_array":shift}])["a"]
assert r["temporal_delta_mae"]==0 and r["prediction_flicker"]>0
print("matte-bench: alpha and temporal metric tests passed")
