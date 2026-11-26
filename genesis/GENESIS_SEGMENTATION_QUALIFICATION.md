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

The provider must expose this identity at runtime. A route without that identity is ineligible even if a historical report exists.

## Evidence required before approval

A qualification record must include:

- Rights-cleared consent and commercial-use permission for evaluation media.
- Participant-level and source-video-level held-out splits.
- For each of the 23 required strata, unique participant count, source-video count, labelled clip count, independent annotator count and its own alpha MAD, edge-band MAD, boundary F1, topology error and temporal delta MAE. A non-empty stratum list is insufficient.
- Independent human alpha annotation and documented review.
- Separate human-labelled per-stratum results for straight, wavy, curly and coily hair; flyaways; braids; dark/light hair-background combinations; backlight; low light; similar colours; glasses; headphones; hats/headwraps; hands crossing face; finger gaps; thin straps; lace; transparent fabric; textured clothes; motion blur; partial occlusion; multiple people; and scene cuts. Every stratum must carry its own alpha MAD, edge-band MAD, boundary F1, topology error and temporal delta MAE, not merely appear in a non-empty list.
- Paired results against the approved baseline, including alpha MAD/MAE, edge-band error, boundary precision/recall/F1, topology/hole retention, temporal error/flicker/ghost duration and failure/reacquisition behaviour.
- Model-only, post-processing and final-composite results separated so one stage cannot hide another stage's regression.
- P50/P75/P95/max stage timing, displayed mask age, preview FPS, memory and sustained thermal/battery evidence on each claimed device tier.
- A review decision recording measurable improvement and no material regression in critical strata.

A public demo image, synthetic fixture, teacher-model agreement, isolated still comparison, successful model load, quick inference time or software-rendered browser run does not satisfy this gate.


## Registered model assets and licence review

The asset hashes below are copied from the current `models/registry.json` at the inspected branch. They identify files, not an approved composite route. The runtime qualification registry deliberately has no composite `modelSha256` yet because the provider has not exposed a canonical pipeline identity that combines the exact assets, preprocess, postprocess and backend.

| Pipeline component | Asset | SHA-256 | Bytes | Declared licence |
|---|---|---|---:|---|
| PP-MattingV2 alpha model | `ppmatting_v2.onnx` | `7846bea9cd2ad94a81b44deeddfa1521bbcfd15bb297c181116eecb25c6f0335` | 35,816,468 | Apache-2.0 in registry |
| EdgeTAM FP16 encoder | `edgetam_vision_encoder_fp16.onnx` | `d8f560849085892866a5c652a600cafbbd301e11c15ff0d89c81e15fe91264ac` | 167,617 | Apache-2.0 in registry |
| EdgeTAM FP16 encoder data | `edgetam_vision_encoder_fp16.onnx_data` | `6a6741eb00b3049939675569818b207953cb13113a80ca9580c9c714d8646b38` | 9,739,536 | Apache-2.0 in registry |
| EdgeTAM decoder | `edgetam_mask_decoder.onnx` | `d3668299ec3edf70fbb139ec642b54bf3d4be453fd1b688a6b5938e0856fe546` | 213,114 | Apache-2.0 in registry |
| EdgeTAM decoder data | `edgetam_mask_decoder.onnx_data` | `dfa2125e30d08d388732f20c18fb63ab0f0f590cd270eb307f0c2b65919d1be8` | 20,958,208 | Apache-2.0 in registry |

The repository's `LICENSES.md` lists Apache-2.0 for PP-MattingV2 and EdgeTAM and asks for upstream/data-term verification before commercial redistribution. This is not a legal clearance: training dataset provenance/terms still require counsel review. RVM GPL-3.0 files remain in the public browser distribution and must be replaced or legally accommodated before a closed-source paid release. BiRefNet's training-data terms are unresolved; MatAnyone 2 and SAM2Matting are non-commercial and must not enter a paid path. No legal sign-off was performed in this execution.

## Current registry

| Route | Status | Reason |
|---|---|---|
| PP-MattingV2 | UNQUALIFIED | No exact-version held-out human-video report is registered |
| Genesis Hybrid | UNQUALIFIED | No exact-version held-out human-video report is registered |
| Genesis UltraMatte | UNQUALIFIED | No exact-version held-out human-video report is registered |

No scores or model hashes are invented here. Update the machine-readable gate and its regression tests only after the evidence above is independently available.
