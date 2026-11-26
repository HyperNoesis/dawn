#!/usr/bin/env python3
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cv2
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

two_subjects = np.zeros((64, 64), np.uint8)
two_subjects[5:45, 5:45] = 255
two_subjects[50:58, 50:58] = 255
main_only = np.zeros_like(two_subjects)
main_only[5:45, 5:45] = 255
topology = alpha_metrics(main_only, two_subjects)
assert topology["small_subject_recall"] == 0 and topology["topology_error_rate"] > 0

with_gap = np.zeros((40, 40), np.uint8)
with_gap[5:35, 5:35] = 255
with_gap[15:25, 15:25] = 0
filled_gap = np.zeros_like(with_gap)
filled_gap[5:35, 5:35] = 255
topology = alpha_metrics(filled_gap, with_gap)
assert topology["target_holes"] == 1 and topology["hole_retention"] == 0
assert topology["topology_error_rate"] > 0

soft = np.zeros((12, 12), np.uint8)
soft[3:9, 3:9] = 255
soft[3:9, 3] = 128
soft_metrics = alpha_metrics(soft, soft)
assert soft_metrics["semi_transparent_mae"] == 0 and soft_metrics["semi_transparent_recall"] == 1

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
    "alpha_encoding": "uint8-0-255",
}
validate_commercial_entry(commercial, 1)
try:
    validate_commercial_entry({**commercial, "independent_annotators": 1}, 1)
    raise AssertionError("one annotator must not satisfy independent review")
except ValueError:
    pass

# Exercise the full manifest -> report path, including every required stratum.
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    cv2.imwrite(str(root / "pred.png"), gt)
    cv2.imwrite(str(root / "gt.png"), gt)
    manifest = []
    for index, stratum in enumerate(REQUIRED_STRATA):
        row = {
            "id": f"frame-{index}", "prediction": "pred.png", "target": "gt.png",
            "usage_rights": "commercial-cleared", "provenance": "consented test fixture",
            "consent_or_lawful_basis": "test-only synthetic fixture; no person data",
            "participant_id": "participant-1", "source_video_id": "source-1",
            "clip_id": "clip-1", "sequence": "sequence-1", "frame": index,
            "split": "test", "strata": [stratum], "annotation_confidence": 0.95,
            "annotation_protocol_sha256": "a" * 64, "inter_annotator_review_sha256": "b" * 64,
            "independent_annotators": 2, "frame_alignment_verified": True,
            "alpha_encoding": "uint8-0-255",
            "runtime": {"inference_ms": 24.0 + index, "mask_age_ms": 40.0, "preview_fps": 24.0},
        }
        manifest.append(row)
    manifest_path = root / "manifest.jsonl"
    manifest_path.write_text("\n".join(json.dumps(row) for row in manifest) + "\n", encoding="utf-8")
    report_path = root / "report.json"
    subprocess.run([
        sys.executable, str(Path(__file__).with_name("evaluate.py")),
        str(manifest_path), "--output", str(report_path), "--require-commercial-clearance",
    ], check=True)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["frame_count"] == len(REQUIRED_STRATA)
    assert len(report["per_stratum"]) == len(REQUIRED_STRATA)
    assert report["per_stratum"]["hair-straight"]["participant_count"] == 1
    assert report["runtime_percentiles"]["inference_ms"]["count"] == len(REQUIRED_STRATA)
    assert "mask_age_ms" not in report["runtime_fields_not_supplied"]
print("matte-bench: alpha, edge, topology, transparency, temporal and manifest evidence tests passed")
