# v0.99.2 — Genesis UltraMatte runtime

## Added

- Frame-locked camera snapshots for async segmentation, so the first person bitmap and model matte use the same source frame.
- MaskMotion v1: confidence-gated low-resolution block-motion propagation for cached soft mattes between model refreshes.
- Hard refusal for low-texture/low-confidence alignment, scene cuts, stale mattes and long frame gaps; a refused alignment suspends until a fresh model result reseeds the stage.
- Diagnostics for mask age, confidence, coverage, alignment state and stage cost.
- A Diagnostics toggle and localStorage kill switch (`vs_mask_motion=0`).
- A synthetic test suite covering translation alignment, static scenes and low-texture rejection.
- Root-level CI gate covering repository unit tests, browser/model gates, export checks and deployable-site build.

## Fixed

- Genesis Hybrid tile refinement and optional tracking now use the exact source frame used by the coarse model pass.
- Existing mobile WebAssembly thread-count unit assertions now match the current mobile policy.
- The full-pipeline browser gate accepts the current offline local engine choices (MediaPipe or MODNet) rather than insisting on the older MediaPipe-only default.

## Validation policy

This release candidate is not promoted to production by this change. Unit/synthetic tests cannot establish real hair accuracy or sustained Android performance. Promotion requires green browser/model/export/build CI, consented real-camera footage with labelled alpha references, and target-phone FPS, thermal, memory and recovery checks.

## Limitations

MaskMotion propagates an existing matte; it is not a new segmentation model and cannot synthesize missing hair alpha. It is disabled automatically for unreliable motion and can always be switched off.

## Timing correction

MaskMotion now distinguishes source-frame time from model-result delivery time. Matte age starts when inference finishes, while the source timestamp is retained for bounded first-frame motion catch-up. The source gap limit is 1.2 seconds and the post-delivery matte lifetime is 1.5 seconds.

- The opt-in composite profile is now presented in the Studio picker as Genesis UltraMatte; the existing stored engine ID remains compatible.
