#!/usr/bin/env python3
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
from evaluate import alpha_metrics, sequence_metrics, validate_commercial_entry, REQUIRED_STRATA

gt = np.zeros((24, 32), np.uint8)
gt[4:20, 8:24] = 255
m = alpha_metrics(gt, gt)
assert m["mae"] == 0 and m["mse"] == 0 and m["boundary_f1"] == 1
assert m["edgeBandMAD"] == 0 and m["topologyErrorRate"] == 0 and m["hole_retention"] == 1

shift = np.zeros_like(gt)
shift[4:20, 9:25] = 255
m = alpha_metrics(shift, gt, 0)
assert m["mae"] > 0 and 0 < m["boundary_f1"] < 1 and m["edgeBandMAD"] > 0

try:
    alpha_metrics(gt, np.zeros((12, 12), np.uint8))
    raise AssertionError("shape mismatch should fail")
except ValueError:
    pass

# A second small subject must not disappear behind a good main-subject score.
two_subjects = np.zeros((64, 64), np.uint8)
two_subjects[5:45, 5:45] = 255
two_subjects[50:58, 50:58] = 255
main_only = np.zeros_like(two_subjects)
main_only[5:45, 5:45] = 255
topology = alpha_metrics(main_only, two_subjects)
assert topology["small_subject_recall"] == 0
assert topology["topology_error_rate"] > 0

# A closed gap/hole filled by the prediction must be visible in topology metrics.
with_gap = np.zeros((40, 40), np.uint8)
with_gap[5:35, 5:35] = 255
with_gap[15:25, 15:25] = 0
filled_gap = np.zeros_like(with_gap)
filled_gap[5:35, 5:35] = 255
topology = alpha_metrics(filled_gap, with_gap)
assert topology["target_holes"] == 1
assert topology["hole_retention"] == 0
assert topology["topology_error_rate"] > 0

# Semi-transparent GT pixels are scored separately from binary foreground.
soft = np.zeros((12, 12), np.uint8)
soft[3:9, 3:9] = 255
soft[3:9, 3] = 128
soft_metrics = alpha_metrics(soft, soft)
assert soft_metrics["semi_transparent_mae"] == 0
assert soft_metrics["semi_transparent_recall"] == 1

r = sequence_metrics([
    {"sequence": "a", "frame": 0, "prediction_array": gt, "target_array": gt},
    {"sequence": "a", "frame": 1, "prediction_array": shift, "target_array": shift},
])["a"]
assert r["temporal_delta_mae"] == 0 and r["prediction_flicker"] > 0
assert r["motion_compensated_flicker"] is None

commercial = {
    "participant_id": "p1", "source_video_id": "v1", "clip_id": "c1",
    "split": "test", "strata": list(REQUIRED_STRATA), "annotation_confidence": 0.9,
    "annotation_protocol_sha256": "a" * 64, "inter_annotator_review_sha256": "b" * 64,
    "independent_annotators": 2, "frame_alignment_verified": True,
}
validate_commercial_entry(commercial, 1)
try:
    validate_commercial_entry({**commercial, "independent_annotators": 1}, 1)
    raise AssertionError("one annotator must not satisfy independent review")
except ValueError:
    pass
print("matte-bench: alpha, edge, topology, transparency, temporal and evidence-protocol tests passed")
