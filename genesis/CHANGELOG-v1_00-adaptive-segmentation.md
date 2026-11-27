# v1.00 — Adaptive segmentation and frame-safe matte delivery

## Changed

- **Automatic is baseline-first.** It starts from the established local route (MediaPipe on constrained/mobile profiles; MODNet where the active device/profile supports it). It does not automatically promote PP-MattingV2, Genesis Hybrid or Genesis UltraMatte while their exact model/preprocess/postprocess/runtime versions lack independent held-out human-video qualification.
- PP-MattingV2, Genesis Hybrid and UltraMatte remain explicitly selectable BETA/test routes. A route becomes eligible for Automatic only after the quality registry records rights-cleared held-out participant/source-video splits, independent human alpha labels, complete per-stratum measurements, critical-stratum non-regression and an exact pipeline identity; the initialized provider must expose and match that identity.
- Legacy explicit `vs_live_engine` choices (`rvm`, `modnet`, `light`) are preserved on upgraded installations. Selecting Automatic or any engine in the new picker writes the new preference and clears a stale legacy override.
- The governor may change resolution on the active route or fall back to the established local baseline. It must not silently cross-promote between unqualified experimental routes.
- Device timing is used only to select among quality-qualified routes. The per-device benchmark cache remains versioned; timing alone never proves image quality.

## Correctness and performance fixes

- MaskMotion's composition policy is explicit: warp only trusted motion, briefly hold the unwarped model matte on low confidence, and pass through the real camera on scene cuts, stale masks, long gaps or unknown states.
- A low-confidence held matte expires; it cannot remain on screen indefinitely.
- Source-frame catch-up now allows up to 1.2 seconds, while matte lifetime after delivery remains bounded at 1.5 seconds.
- Flow vectors are interpolated between block centres; canvas/ImageData/alpha buffers are reused to reduce allocation and compositing overhead.
- EdgeTAM's square encoder input is aspect-preserving and padded rather than stretched. Gate alpha is mapped back into the source matte's native geometry.
- Standalone EdgeTAM snapshots its input frame before asynchronous base-model inference and uses that same snapshot for the tracker refresh, preventing stale-frame gate/matte mismatches.
- Automatic model probes have bounded dependency loading, model initialization and per-frame inference waits; a failed candidate does not keep the baseline renderer or inference paused.

## Regression coverage

- Automatic safe-start behavior and explicit engine choices.
- UltraMatte construction for background probes without mutating the selected setting.
- Legacy preference migration to Automatic.
- State transitions for trusted warp, low-confidence hold, scene cuts, stale mattes, frame gaps and expiry.
- Aspect-ratio mapping for landscape and portrait EdgeTAM inputs.
- Qualification-gated governor transitions; exact-version mismatches fail closed and unqualified routes cannot be silently promoted.

## Validation boundary

The browser and motion gates use synthetic camera clips and software-rendered Chromium in CI. They validate code paths, state transitions, measured model/runtime performance on that runner, and regressions against known fixtures. They do not prove real-person hair/finger alpha quality, long-session thermal stability or universal performance on physical Android/iOS devices. Real, consented footage and target-device testing remain release requirements.
