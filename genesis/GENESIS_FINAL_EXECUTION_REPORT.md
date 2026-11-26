# Genesis final execution report

**Execution date:** 26 November 2026  
**Repository:** `HyperNoesis/dawn`  
**Continuation branch:** `genesis/final-studio-segmentation-execution`  
**Starting commit:** `e01e09e057687048223fdc2cb8d559b83c1e38ac`  
**Base:** `main` at `adb10802c66ab4f58c234063f77cad96779866b4`

## Source-of-truth and preservation

The live repository was rechecked before editing. PR #5 is open and draft, based on `main`, and its head is 143 commits ahead and 0 behind `main`. A separate continuation branch was created from the exact PR #5 head. PR #5 and `main` were not rewritten or merged.

PR #5 already carries substantial work across adaptive segmentation, frame snapshots, hybrid refinement, camera/runtime behaviour, security, storage, Android packaging and automated tests. This execution preserves that work and adds a separate continuation rather than replacing it.

## Confirmed baseline

- Android debug job for PR #5 head: PASS, run 45583194793.
- Segmentation regression job for PR #5 head: CANCELLED, run 45583194549. It stopped during Python dependency installation; substantive test steps were skipped. This is not a passing segmentation run.
- The repository device matrix had no actual filled measurements.
- The UltraMatte Playwright gate uses a synthetic camera fixture and explicitly does not establish real-person quality.

## Changes in this continuation

- Added a fail-closed quality qualification registry for PP-MattingV2, Genesis Hybrid and Genesis UltraMatte. None is currently approved for automatic promotion. Explicit manual testing remains possible.
- Gated automatic experimental-route promotion on exact model/preprocessing/postprocessing/runtime identity and complete held-out evidence. The established local baseline remains available.
- Added monotonic IDs and immutable metadata packets to captured source-frame snapshots: timestamp, dimensions, orientation, source video/stream identity and provider generation.
- Added provider-generation checks to asynchronous and synchronous inference result acceptance, preventing a result from a superseded provider/cache generation from reaching the compositor.
- Exposed source-frame/mask age metadata to diagnostics.
- Retained the existing bounded 1,500 ms maximum mask age after the stricter 150 ms experiment changed the existing motion-gap regression's documented failure reason. The value remains provisional and must be calibrated with real video/device evidence before adjustment.
- Added unit coverage for the fail-closed qualification policy, exact-version invalidation and complete coverage of all 23 required quality strata.
- Marked unmeasured physical-device rows as blocked rather than filling estimates.

## Validation

GitHub Actions on the earlier continuation head confirmed Python dependencies, model restoration, protected service tests, JavaScript syntax, the complete pure-logic/provider unit suite (including the new quality qualification test), and the Android debug build. The dedicated motion E2E unit then failed because the experimental 150 ms mask-age cutoff changed the asserted failure reason from `frame-gap` to `stale-mask`. That threshold was reverted to the existing 1,500 ms cap rather than weakening the existing test. A fresh CI run on the latest head is required to verify the correction and run the remaining browser, export and site-build gates.

A local Dawn checkout and working outbound network for cloning/installing repository dependencies were not available in this execution environment. Local Node/Python/Playwright/Gradle commands were therefore not executed here. Physical Android/iOS sessions, real-footage labels, commercial data rights, production credentials, signed release publishing and live WHIP verification remain external acceptance gates.

## Release verdict

**Not production-ready.** The code-level fixes and automated checks that can be performed in the repository should be completed and CI reviewed. Real-human segmentation quality, target-device sustained performance, the complete Studio journey matrix and external production configuration remain unverified or blocked. No merge, deployment, paid service activation or signed production release was performed.
