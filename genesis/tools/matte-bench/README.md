# Genesis matte benchmark

Compare predicted alpha with independent, aligned, human-labelled alpha targets. Same-model parity, ordinary RGB photos, teacher-model agreement and synthetic fixtures are not real-human ground truth.

## JSONL manifest

One JSON object per line. Prediction/target paths are relative to the manifest. Include one row per aligned frame. For a commercial held-out evaluation, each row must also include:

- `participant_id`, `source_video_id`, `clip_id`, and `split: "test"` (or `"benchmark"`); participants and source videos may not cross splits.
- One or more `strata` labels from the 23 required difficult-scene/hair categories.
- `usage_rights: "commercial-cleared"`, provenance, and a documented consent/lawful-basis record.
- Annotation confidence in [0, 1], hashes for the annotation protocol and inter-annotator review, at least two independent annotators, and `frame_alignment_verified: true`.
- Optional per-frame runtime observations: inference time, displayed-mask age, camera/render/preview FPS, dropped frames, memory and battery.

See `manifest.schema.json` for the field contract. The evaluator rejects shape mismatches; it never silently resizes. The commercial-clearance flag verifies that declarations and required evidence fields are present. It is an audit guard, not legal advice or proof that permissions are valid. Keep identity-bearing footage private and access-controlled.

## Run from genesis/

    python tools/matte-bench/evaluate.py /path/to/manifest.jsonl --output report.json
    python tools/matte-bench/evaluate.py /path/to/manifest.jsonl --require-commercial-clearance
    python tools/matte-bench/test_metrics.py

The report includes alpha MAE/MAD, MSE, SAD per 1000 pixels, gradient MAE, tolerant boundary precision/recall/F1, edge-band error, alpha calibration, semi-transparent-region error/recall, connected-component and hole/finger-gap proxies, small-subject recall, false-component rate, temporal delta MAE, per-clip and per-stratum results, deterministic clip-level bootstrap confidence intervals, and runtime P50/P75/P95/max where supplied.

Topology scores are diagnostics, not a replacement for visual review of fingers, hair loops or small subjects. Motion-compensated flicker, ghost duration and reacquisition time remain explicitly unreported until aligned source RGB frames and track/occlusion annotations are supplied. Runtime and resource fields absent from the manifest are listed as not supplied; they are never inferred.

Flicker is reported beside temporal error because an over-smoothed but lagging matte is not a win. Always compare the same source clips, frames, resolution, crop geometry and post-processing policy across engines, and publish worst cases as well as aggregate averages.
