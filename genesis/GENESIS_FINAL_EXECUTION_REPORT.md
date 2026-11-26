# Genesis final studio & segmentation mission: execution report (in progress)

Branch `claude/final-studio-segmentation`, based on PR #5 head `e01e09e057687048223fdc2cb8d559b83c1e38ac` (main = `adb10802`).
Status: **PARTIAL. Not a release candidate.** Stages 0, 2 (partly) and 3 are done. Stages 1 and 4–10 are NOT RUN.

## Verified (local, Node v22.23.5, commit df64d9d)
| Gate | Result |
|---|---|
| `npm run test:unit` (tools/unit) | PASS (all suites, incl. new frame-epoch, engine-qualification) |
| `tools/e2e/unit_*.js` | PASS (all) |
| `node --check js/app.js` | PASS |
| Baseline at e01e09e | 1 FAIL: `edgetam-provider.test.js`, a test-environment bug (Node ≥21 read-only `navigator`); fixed in test only |

## Changes
1. **Frame-identity gate** (`js/providers/frame-epoch.js`): async mattes carry a ticket (epoch, camera session, provider, source geometry/orientation, sequence). Late results after provider switch, cache reset, camera restart, orientation change, or tab resume are dropped; an older result can never overwrite a newer one. Sync path also guarded and null-safe.
2. **Tab resume** now invalidates in-flight inference (no visibilitychange handler existed).
3. **Quality qualification registry** (`js/providers/engine-qualification.js`): approval requires held-out real-video evidence (≥5 participants, ≥20 clips, no critical regression) bound to weight hashes and pre/post-processing versions. Today only MODNet (baseline) qualifies. **Behaviour change:** Automatic no longer auto-promotes UltraMatte/Hybrid/PP-MattingV2 unless `localStorage vs_auto_experimental=1`. Explicit user selections are unchanged. No UI toggle yet.

## NOT RUN / BLOCKED
- NOT RUN: Playwright browser/model gates, matte-edge gate, server tests, export, PWA build, Android build, CI on this SHA (needs CI run).
- NOT RUN: Stage 1 defect ledger, Stage 4/5 tile/temporal work, Stage 6 control audit, Stage 7 CSS, Stage 8 licence/security audit (RVM GPL-3.0 decision still open).
- BLOCKED: real-human alpha benchmark (no consented labelled footage); physical-device matrix (no devices); signed release (no secrets).

## Needs your decision
- Keep Automatic gated behind the experimental opt-in (compliant with the brief) or add a visible "Experimental routes" toggle in Settings?
