# Genesis segmentation qualification (2026-11-26, branch claude/final-studio-segmentation)

## Approval status
| Engine | Status | Evidence | Licence |
|---|---|---|---|
| MODNet | baseline (shipped default; not a quality claim) | none new | Apache-2.0 |
| PP-MattingV2 | **experimental** | small research-only P3M still sample (non-commercial data); synthetic gates | Apache-2.0 |
| Genesis Hybrid | **experimental** | synthetic gates; tile re-run of PP-MattingV2, not a learned hair matte | Apache-2.0 |
| Genesis UltraMatte (Hybrid + EdgeTAM) | **experimental** | synthetic fixture, software-GL Chromium | Apache-2.0 |
| PP-Matting HRNet / BiRefNet-lite | experimental (export/still) | none | Apache-2.0 / MIT (training-data terms unresolved) |
| RVM | explicit opt-in only | synthetic gates | **GPL-3.0, review before closed-source release** |

Approval rule (code: `js/providers/engine-qualification.js`, test `tools/unit/engine-qualification.test.js`): ≥5 participants, ≥20 clips, held-out real-video alpha, no critical-stratum regression, bound to weight hashes and pre/post-processing versions. **No engine meets it.** Genesis MatteNet is a specification only, with no weights.

## Pipeline
camera frame → captured snapshot → provider (MODNet / PP-MattingV2 / Hybrid / EdgeTAM) → mask clean → MaskMotion → compositor. Async results are ticketed (`frame-epoch.js`): epoch, camera session, provider, source geometry/orientation, sequence.

## Measured (SYNTHETIC fixture, software-rendered Chromium 153, Node 22; NOT phone or human evidence)
UltraMatte gate, 10 sequential frames, 512x384 mask: p50 628 ms, p75 776 ms, p95 3503 ms, max 3503 ms (first-frame and one GC/compile outlier), about 1.29 mask updates/s at p75. Synthetic GT raw matte: alpha MAE 0.004, foreground IoU about 0.985. Edge MAE 0.13-0.17 (raw) vs 0.29-0.35 (studio matte) indicates the render edge stage softens the edge band on this fixture; the experimental thresholds (0.15/0.85, 0.05/0.95) lower it to 0.21-0.30. Production defaults unchanged. Raw log: `reports/ultramatte_gate_2026-11-26.log`.
Other gates (t40 pipeline, t41 MODNet, t43 RVM, t44 threads, t42 enhance, t49 matte-edge): PASS.

## Not done
Held-out human alpha benchmark, per-stratum metrics, Pareto table: BLOCKED (no consented labelled footage). Dataset protocol in the mission brief stands; no data has been collected.

---
## Real-image evidence added 2026-11-27 (still NOT enough to approve any engine)

Data: 12 real portrait photos with human-annotated alpha (P3M demo set, research/non-commercial licence, test only, never committed or shipped). Engines are the shipped browser providers (onnxruntime-web WASM, Chrome 153), 1280 px frames, fast/balanced presets, CPU software GL. Scripts: `tools/e2e/get_real_gt.sh`, `t63_real_gt_bench.js`, `tools/matte-bench/score_real_gt.py`. Raw numbers: `reports/real_gt_scores_2026-11-27.json`.

### Alpha error vs human ground truth (MAE x1000, lower is better; n = 12 photos)
| Engine | clean | low light | sensor noise | defocus blur | low contrast | clean fg-IoU |
|---|---|---|---|---|---|---|
| MODNet | 23.1 | 93.7 | 66.7 | 33.2 | 18.7 | 0.933 |
| PP-MattingV2 | 15.8 | 47.6 | 24.6 | 16.1 | 14.6 | 0.950 |
| Genesis Hybrid | 15.7 | 47.5 | 24.8 | 16.2 | 14.8 | 0.951 |
| **Genesis UltraMatte (after fix)** | **10.3** | **47.2** | **21.3** | **11.0** | **9.9** | **0.965** |
| UltraMatte BEFORE the fix | 148.7 | 174.5 | 155.8 | 71.4 | 13.2 | 0.572 |

Degradations change the RGB only (brightness x0.28 + noise; gaussian noise; 3 px blur; contrast x0.45); GT alpha is unchanged. Low light remains hard for every engine (about 2-4x worse than clean).

### Defect found by this benchmark and fixed
UltraMatte returned an EMPTY matte (subject deleted) on 4 of 12 photos. Cause: the EdgeTAM gate made for one frame stayed active for up to 8 frames and was applied to a different subject (camera switch / scene cut / large move) with no per-frame safety check and no reset. Fix: per-frame `keptFraction` check (a gate keeping under 50 percent of the current foreground is dropped, re-seeded next frame, and the ungated matte is shown) and `resetTemporal()` clearing the gate. Unit-tested (`edgetam-core.test.js`); verified on the real photos (148.7 → 10.3). Automatic mode could not have shipped this route anyway under the new qualification gate.

### Motion clips built from real portraits (4 photos x 24 frames, pan/zoom/rotate + noise, same warp on RGB and GT; not real video)
| Engine | mean MAE x1000 | flicker x1000 | empty frames | mask lag | p50 ms/frame |
|---|---|---|---|---|---|
| MODNet | 5.38 | 8.06 | 0 | 0 | 1091 |
| PP-MattingV2 | 7.40 | 10.55 | 0 | 0 | 317 |
| Hybrid | 7.64 | 10.92 | 0 | 0 | 318 |
| UltraMatte | 7.06 | 10.29 | 0 | 0 | 361 (first frame 3.2 s) |
On these four easy portraits with simple motion, MODNet is as accurate and slightly steadier. The advanced routes win on hard stills (hair, low light, blur), not on this clip set. Flicker figures are relative to 22 (x1000) of true GT motion.

### Limits (why nothing is approved)
12 stills from one non-commercial dataset, one body of people, no real video, no motion blur, no phone, authors' PP-Matting models may have seen P3M in training (unverified). The qualification rule (>=5 participants, >=20 held-out real-video clips) is not met, so Automatic still treats these routes as experimental. CPU throttling (`--cpu=N`) only slows the main thread, not the inference worker, so it is NOT a phone latency proxy; do not quote the throttled latencies.

### Recording soak (t65, Chrome 4x main-thread throttle, fake camera+mic, 300 s)
Preview never froze (0 of 20 samples), JS heap 22 → 19 MB (max 24), saved file 22.1 MB webm (VP9+Opus), video 302.85 s vs 303 s wall, audio 302.34 s (drift 0.5 s), audio not silent, 0 page errors. The file was 480x270 and the on-screen FPS counter read 3-8 under software GL + throttle. It says nothing about a real phone's sustained thermals.
