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
- Independent human alpha annotation and documented review.
- Separate human-labelled per-stratum results for straight, wavy, curly and coily hair; flyaways; braids; dark/light hair-background combinations; backlight; low light; similar colours; glasses; headphones; hats/headwraps; hands crossing face; finger gaps; thin straps; lace; transparent fabric; textured clothes; motion blur; partial occlusion; multiple people; and scene cuts. Every stratum must carry its own alpha MAD, edge-band MAD, boundary F1, topology error and temporal delta MAE, not merely appear in a non-empty list.
- Paired results against the approved baseline, including alpha MAD/MAE, edge-band error, boundary precision/recall/F1, topology/hole retention, temporal error/flicker/ghost duration and failure/reacquisition behaviour.
- Model-only, post-processing and final-composite results separated so one stage cannot hide another stage's regression.
- P50/P75/P95/max stage timing, displayed mask age, preview FPS, memory and sustained thermal/battery evidence on each claimed device tier.
- A review decision recording measurable improvement and no material regression in critical strata.

A public demo image, synthetic fixture, teacher-model agreement, isolated still comparison, successful model load, quick inference time or software-rendered browser run does not satisfy this gate.

## Current registry

| Route | Status | Reason |
|---|---|---|
| PP-MattingV2 | UNQUALIFIED | No exact-version held-out human-video report is registered |
| Genesis Hybrid | UNQUALIFIED | No exact-version held-out human-video report is registered |
| Genesis UltraMatte | UNQUALIFIED | No exact-version held-out human-video report is registered |

No scores or model hashes are invented here. Update the machine-readable gate and its regression tests only after the evidence above is independently available.
