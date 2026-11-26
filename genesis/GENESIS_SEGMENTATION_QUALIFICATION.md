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
