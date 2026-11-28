# Genesis matte benchmark

Compare predicted alpha with independent, aligned, hand-labelled or otherwise rights-cleared alpha targets. Same-model parity, ordinary RGB photos, and synthetic fixtures without independent alpha are not ground truth.

## JSONL manifest
One JSON object per line. Paths are relative to the manifest:
{"id":"clip-01-f0001","prediction":"pred/0001.png","target":"gt/0001.png","sequence":"clip-01","frame":1,"split":"test","usage_rights":"commercial-cleared","provenance":"consented capture; annotator protocol v1","consent_or_lawful_basis":"documented participant consent"}

See manifest.schema.json. Use research-only or permission-pending honestly. Keep identity-bearing footage private and access-controlled.

## Run from genesis/

    python tools/matte-bench/evaluate.py /path/to/manifest.jsonl --output report.json
    python tools/matte-bench/evaluate.py /path/to/manifest.jsonl --require-commercial-clearance
    python tools/matte-bench/test_metrics.py

Dimensions must match; the evaluator never silently resizes. Metrics include MAE, MSE, SAD/1000px, gradient MAE, tolerant binary-boundary F1, semi-transparent-pixel counts and sequence temporal-delta error. Lower errors are better; boundary F1 is higher-is-better.

Flicker is reported beside temporal error because an over-smoothed but lagging matte is not a win. The clearance switch checks manifest declarations and provenance/basis fields; it is an audit guard, not legal advice or proof that dataset permissions are valid. Review upstream terms before training or commercial use.
