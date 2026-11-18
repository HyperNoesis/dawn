# v0.95 changes (17 Nov 2026), all unit-tested and run in real Chromium; NOT run on a phone
1. matte-refine.js: keepMainSubject (stray-blob removal, evidence-based 6% default). Stills/export default ON; live opt-in (vs_ppm_main=1).
2. engine-policy.js: measured-speed memory (recordMeasured/isSlow). Lab records p95 (>=30 frames); the router refuses PP-Matting live on a device whose own p95 > 83 ms (override: vs_pp_force=1).
3. app.js ladder: PP-Matting now steps down in resolution like MODNet/RVM (regex + label). Not yet verified on a slow phone.
4. sw.js: new segmentation files precached; shell cache v122.
5. enhance.js: engine picker in the Enhance UI (only shown when more than MODNet is offered).
Tests: 11 unit files + 44 unit_* suites pass; t42, t46, t47 (also with live cleanup on) pass in real Chromium. tools/e2e/t33_ladder_smoke needs its own server on :8123 and was not run.
