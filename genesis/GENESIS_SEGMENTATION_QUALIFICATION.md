# Genesis segmentation quality qualification

**Status: BLOCKED for automatic promotion of experimental routes.**  
**Repository:** `HyperNoesis/dawn`  
**Execution date:** 26 November 2026

## Decision

Automatic mode may use the established local baseline, but it must not promote PP-MattingV2, Genesis Hybrid or Genesis UltraMatte based on speed and successful initialization alone. The automatic quality gate is fail-closed for all three experimental routes.

They remain available for explicit user selection/testing. That is not a quality endorsement and does not change their BETA/experimental status.

## Why the gate is closed

The repository contains a synthetic-camera UltraMatte integration gate (`tools/e2e/t50_ultramatte_gate.js`). It loads the bundled PP-MattingV2 and EdgeTAM models, runs the composed provider, and compares against a labelled synthetic fixture. The test itself explicitly says this is not proof of real-person segmentation quality.

The repository inspection and current CI record do not establish a complete, current set of consented, rights-cleared, independently human-labelled video clips or a populated physical-device matrix. There is consequently no evidence to qualify fine hair, fingers, translucent materials, occlusion, multiple people, backlight, low light, motion blur or temporal stability for production use.

## Qualification identity

An approval is scoped to all of the following fields. Any change invalidates the approval:

- Model version and SHA-256 (for a composed route, a canonical hash of every required model asset).
- Preprocessing hash.
- Postprocessing/refinement hash.
- Runtime backend identity.

The provider must expose this identity at runtime. PP-MattingV2, Genesis Hybrid and the EdgeTAM-wrapped UltraMatte route now compute it from the actual loaded model files, registry version, hashed preprocessing/postprocessing resources and configuration, and actual ONNX runtime bundle/backend. The model-browser integration test asserts that these live hashes are complete. A route without a complete identity is ineligible even if a historical report exists; a complete identity alone is not a quality approval.

## Evidence required before approval

A qualification record must include:

- Rights-cleared consent and commercial-use permission for evaluation media.
- Participant-level and source-video-level held-out splits, with no participant/source-video leakage between splits.
- Independent human alpha annotation by at least two annotators; a hashed annotation protocol, completed inter-annotator review, frame-synchronisation manifest, dimensions/alpha-encoding verification and annotation-confidence manifest.
- For each of the 23 required strata, unique participant count, source-video count, labelled clip count, at least two independent annotators and its own alpha MAD, edge-band MAD, boundary F1, topology error and temporal delta MAE. A non-empty stratum list is insufficient.
- Rights, dataset, benchmark, annotation protocol, inter-annotator review, frame-alignment and confidence artefacts must each be SHA-256 identified.
- Separate human-labelled per-stratum results for straight, wavy, curly and coily hair; flyaways; braids; dark/light hair-background combinations; backlight; low light; similar colours; glasses; headphones; hats/headwraps; hands crossing face; finger gaps; thin straps; lace; transparent fabric; textured clothes; motion blur; partial occlusion; multiple people; and scene cuts. Every stratum must carry its own alpha MAD, edge-band MAD, boundary F1, topology error and temporal delta MAE, not merely appear in a non-empty list.
- Paired results against the approved baseline, including alpha MAD/MAE, edge-band error, boundary precision/recall/F1, topology/hole retention, temporal error/flicker/ghost duration and failure/reacquisition behaviour.
- Model-only, post-processing and final-composite results separated so one stage cannot hide another stage's regression.
- P50/P75/P95/max stage timing, displayed mask age, preview FPS, memory and sustained thermal/battery evidence on each claimed device tier.
- A review decision recording measurable improvement and no material regression in critical strata.

A public demo image, synthetic fixture, teacher-model agreement, isolated still comparison, successful model load, quick inference time or software-rendered browser run does not satisfy this gate.


## Registered model assets and licence review

The asset hashes below are copied from the current `models/registry.json` at the inspected branch. They identify files, not an approved composite route. The runtime qualification registry deliberately has no approved experimental-route record yet because independent, rights-cleared human-video evidence is still absent. Runtime identity is now computed live and includes the exact loaded model assets, registry version, preprocessing and postprocessing resources/configuration, and actual runtime backend/bundle. The identity is reported by the synthetic browser gate; it is not itself an approval.

| Pipeline component | Asset | SHA-256 | Bytes | Declared licence |
|---|---|---|---:|---|
| PP-MattingV2 alpha model | `ppmatting_v2.onnx` | `7846bea9cd2ad94a81b44deeddfa1521bbcfd15bb297c181116eecb25c6f0335` | 35,816,468 | Apache-2.0 in registry |
| EdgeTAM FP16 encoder | `edgetam_vision_encoder_fp16.onnx` | `d8f560849085892866a5c652a600cafbbd301e11c15ff0d89c81e15fe91264ac` | 167,617 | Apache-2.0 in registry |
| EdgeTAM FP16 encoder data | `edgetam_vision_encoder_fp16.onnx_data` | `6a6741eb00b3049939675569818b207953cb13113a80ca9580c9c714d8646b38` | 9,739,536 | Apache-2.0 in registry |
| EdgeTAM decoder | `edgetam_mask_decoder.onnx` | `d3668299ec3edf70fbb139ec642b54bf3d4be453fd1b688a6b5938e0856fe546` | 213,114 | Apache-2.0 in registry |
| EdgeTAM decoder data | `edgetam_mask_decoder.onnx_data` | `dfa2125e30d08d388732f20c18fb63ab0f0f590cd270eb307f0c2b65919d1be8` | 20,958,208 | Apache-2.0 in registry |

The repository's `LICENSES.md` lists Apache-2.0 for PP-MattingV2 and EdgeTAM and asks for upstream/data-term verification before commercial redistribution. This is not a legal clearance: training dataset provenance/terms still require counsel review. RVM GPL-3.0 files remain in the public browser distribution and must be replaced or legally accommodated before a closed-source paid release. BiRefNet's training-data terms are unresolved; MatAnyone 2 and SAM2Matting are non-commercial and must not enter a paid path. No legal sign-off was performed in this execution.

## Synthetic CI integration evidence — run 45847956492

This evidence is reproducible integration output for commit `a46fd4c545418fe6216edba4c565b98d2d50e692`. It is **not** a human-video qualification and does not change the three routes' `UNQUALIFIED` status.

| Gate / metric | Observed | Scope |
|---|---:|---|
| UltraMatte provider initialisation | 2,495 ms | Chromium CI, local ONNX Runtime Web 1.25.1 / WASM |
| UltraMatte segmentation P50 | 464 ms | 10 sequential synthetic frames |
| UltraMatte segmentation P75 | 602 ms | 10 sequential synthetic frames |
| UltraMatte segmentation P95 / max | 2,790 ms | 10 sequential synthetic frames |
| Estimated updates/s at P75 | 1.66 | Reciprocal of 602 ms; not a measured phone FPS |
| Raw matte alpha MAE | 0.00456 | Generated labelled fixture |
| Final Studio matte alpha MAE | 0.00433 | Same generated fixture, after render matte stage |
| Raw matte transition-band MAE | 0.18079 | Ground-truth alpha values strictly between 8 and 247, normalised by 255 |
| Final Studio transition-band MAE | 0.34012 | Same fixture after render matte stage |
| Foreground IoU, raw / final | 0.98449 / 0.98340 | Binary threshold 127 on synthetic fixture |
| Diagnostic soft-edge A/B transition-band MAE | 0.30514 / 0.27887 | Parameters 0.15–0.85 and 0.05–0.95; diagnostic only, not promoted |
| EdgeTAM state | ready / gate active | Synthetic browser integration |
| Hybrid tile activity | 16 attempted, 9 refined, 20 deferred, 7 rejected over 10 frames | Tile budget 3/frame; 0 reported errors or snapshot failures |

The fixture is `tools/e2e/fixtures/gt_alpha_640x480.png`; the output comparison depicts a generated cartoon presenter. It does not contain a consented natural human subject, genuine hair, transparent cloth, real hands, backlight or human motion.

The separate baseline camera gate sampled 28 frames in 8.07 seconds (3.47 sample FPS). The test captures one stats string immediately after Start (0 FPS / 1,495 ms during camera/model startup), then changes the scene, waits 3 seconds and captures later app stats (about 4 FPS / 375 ms). These are different points in the warm-up sequence, not contradictory simultaneous readings. The measured 3.47 FPS preview sample is still far below the brief's 24 FPS target intent. This synthetic result is not a phone measurement.

**Interpretation:** the integration path executes and its generated-fixture scores are reproducible, but P75/P95 timing is far from a 24 FPS live-video objective. The renderer also increases the transition-band error in this fixture compared with the raw alpha; the diagnostic softer-edge A/B improves that synthetic metric but is not sufficient reason to change production defaults. Automatic promotion therefore remains disabled. Re-run with rights-cleared human video and target hardware before changing this decision.

## Current registry

| Route | Status | Reason |
|---|---|---|
| PP-MattingV2 | UNQUALIFIED | No exact-version held-out human-video report is registered |
| Genesis Hybrid | UNQUALIFIED | No exact-version held-out human-video report is registered |
| Genesis UltraMatte | UNQUALIFIED | No exact-version held-out human-video report is registered |

No scores or model hashes are invented here. Update the machine-readable gate and its regression tests only after the evidence above is independently available.

## Numeric quality policy v1

A route cannot be approved merely because its evidence metadata is complete. The executable gate enforces these provisional normalized limits on the aggregate result **and independently on every required stratum**:

| Metric | Acceptance |
|---|---:|
| Alpha MAD | ≤ 0.05 |
| Edge-band MAD | ≤ 0.08 |
| Boundary F1 | ≥ 0.90 |
| Topology error rate | ≤ 0.05 |
| Temporal delta MAE | ≤ 0.05 |

The executable constants are exported as `QUALITY_LIMITS` by `js/providers/matte-quality-qualification.js`. P95 latency is recorded but is not a universal image-quality threshold: performance qualification remains device/profile-specific and is applied only after quality qualification. These thresholds are an explicit v1 engineering acceptance policy, not measured results or a claim that any engine currently meets them. They must be validated against the agreed annotation protocol and baseline set before production sign-off.



## Current-head integration evidence — 26 November 2026

Executable-code commit: `8bfffcb3585bdad8c63eb5d5a13674c28423a7c8`. Segmentation workflow [45908860131](https://github.com/HyperNoesis/dawn/actions/runs/45908860131) completed successfully, including provider/unit tests, Studio shell smoke, camera/model/motion/matte-edge browser gates, export/API regression and the deployable site build. The run artifact is `genesis-segmentation-gate-report` (artifact ID `15159048796`).

- Runtime identity was exercised against the actually loaded PP-MattingV2 and EdgeTAM model assets using bundled ONNX Runtime Web 1.25.1 / WASM. The route returned model SHA-256 `24c7dacf613b8db1ac01949194c107ad4896b2c74cbe6fb2d69fac9149f2f87b`, preprocessing SHA-256 `809667cb5562161b69c5ed3022a41f07b69277720fdaaa91c0238725cbc469a2`, postprocessing SHA-256 `ee95b568836114cf96d7dedbe11fdd3c3849cbf3fd3bd2fbdef81510d9cec64d`, plus separate PP-Matting and EdgeTAM runtime/backend hashes. CDN or unidentified runtime sources fail closed for automatic qualification.
- The Studio shell smoke test passed 17/17 tabs. It checked panel reachability, ARIA tab/panel relationships, Arrow/Home/End keyboard navigation, exactly one selected tab, no horizontal overflow at 360×800, 768×1024 and 1440×900, and zero uncaught page errors, console errors, failed local requests or local HTTP errors. Screenshots and the JSON report are in the workflow artifact. This is a shell/navigation check, not the full workflow of every tool.
- Synthetic UltraMatte model run: initialization 2,513 ms; 10 measured frames; segmentation P50 475 ms, P75 611 ms, P95/max 2,629 ms (about 1.64 mask updates/s at P75). The Hybrid refinement scheduler attempted 16 tiles, refined 9, deferred 20, cached 33 and rejected 7 across the sample, with zero reported errors. These numbers come from a synthetic generated presenter, not a target phone.
- Across the same synthetic fixture frames, mean raw-alpha MAE was 0.00542 and mean final Studio alpha MAE was 0.00523, while mean transition-band error worsened from 0.18545 at raw alpha to 0.33888 after the Studio compositor. Two experimental edge settings reduced that synthetic transition-band error to 0.30356 and 0.27792, but remain diagnostic-only and were not promoted.
- The generic synthetic camera gate sampled 36 frames over 8.01 seconds (4.49 FPS); its later in-app stats sample reported 5 FPS and 186 ms frame latency after warm-up. This is software-browser evidence and does not describe phone performance.
- Android debug job [45908860172](https://github.com/HyperNoesis/dawn/actions/runs/45908860172) passed and uploaded a test-only debug APK (artifact ID `15159082802`). Signed release was skipped. No physical installation or device measurement was performed.

**Interpretation:** the runtime-identity integration is fixed and exercised; Studio shell navigation/responsive overflow checks now have current-head evidence; the code builds and the synthetic integration path runs. The 611 ms P75 segmentation time is far from a 24 FPS objective, and the final compositor materially worsens transition-band error on the synthetic fixture. Do not promote the route or call the segmentation quality solved on this evidence.
