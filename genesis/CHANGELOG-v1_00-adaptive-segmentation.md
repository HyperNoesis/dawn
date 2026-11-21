# v1.00 — Adaptive segmentation and frame-safe matte delivery

## Changed

- Automatic mode now starts immediately with the existing device-appropriate local live model (MODNet on quality-first desktop routes; MediaPipe remains the lightweight mobile/emergency baseline).
- Automatic mode then probes advanced local routes in the background in quality order: Genesis UltraMatte (PP-MattingV2 + EdgeTAM + boundary tiles), Genesis Hybrid, and PP-MattingV2. A candidate is promoted only if its measured mask time fits the live budget. A route that is too slow or fails to initialise is skipped, not treated as success.
- The adaptive mode supersedes the previous `vs_live_engine` MODNet/RVM preference so old settings cannot silently disable the new probe sequence. The explicit `light` override remains respected.
- The live governor uses a route-aware degradation chain and retains its ability to recover when performance headroom returns.
- The per-device benchmark cache version is incremented so old measurements do not suppress new routes.

## Correctness and performance fixes

- MaskMotion's composition policy is explicit: warp only trusted motion, briefly hold the unwarped model matte on low confidence, and pass through the real camera on scene cuts, stale masks, long gaps or unknown states.
- A low-confidence held matte expires; it cannot remain on screen indefinitely.
- Source-frame catch-up now allows up to 1.2 seconds, while matte lifetime after delivery remains bounded at 1.5 seconds.
- Flow vectors are interpolated between block centres; canvas/ImageData/alpha buffers are reused to reduce allocation and compositing overhead.
- EdgeTAM's square encoder input is aspect-preserving and padded rather than stretched. Gate alpha is mapped back into the source matte's native geometry.

## Regression coverage

- Automatic safe-start behavior and explicit engine choices.
- UltraMatte construction for background probes without mutating the selected setting.
- Legacy preference migration to Automatic.
- State transitions for trusted warp, low-confidence hold, scene cuts, stale mattes, frame gaps and expiry.
- Aspect-ratio mapping for landscape and portrait EdgeTAM inputs.
- Simulated quality-governor transitions through the advanced fallback chain.

## Validation boundary

The browser and motion gates use synthetic camera clips and software-rendered Chromium in CI. They validate code paths, state transitions, measured model/runtime performance on that runner, and regressions against known fixtures. They do not prove real-person hair/finger alpha quality, long-session thermal stability or universal performance on physical Android/iOS devices. Real, consented footage and target-device testing remain release requirements.
