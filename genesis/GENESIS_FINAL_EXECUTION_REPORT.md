# Genesis final studio & segmentation mission: execution report (in progress)

Branch `claude/final-studio-segmentation`, based on PR #5 head `e01e09e057687048223fdc2cb8d559b83c1e38ac` (main = `adb10802`).
Status: **PARTIAL. Engineering work for what is possible in this workspace is staged; NOT a release candidate** (no real footage, no devices, no CI on this SHA).

## Verified locally (Node v22.23.5, Chrome 153 software GL, models fetched+checksummed)
| Gate | Result |
|---|---|
| `npm run test:unit` + all `tools/e2e/unit_*.js` | PASS |
| Whole-tree `node --check` (js, tools/e2e, server, scripts) | PASS |
| `server` tests (signalling, render relay) | PASS |
| Python: pipeline_logic, scene_logic, export_safety, export_e2e, matte-bench metrics, gpu export api | PASS |
| Browser: t40 pipeline, t41 MODNet, t43 RVM, t44 threads, t42 enhance, t49 matte-edge, t50 UltraMatte | PASS (synthetic camera) |
| `sh scripts/build-site.sh` | PASS (322 files, 404M) |
| t60 audit, t61 journeys (all PASS), t62 screenshots | PASS |
| Android debug build, CI on this SHA | NOT RUN (a PR is needed to trigger CI; creating it returned HTTP 403) |
| Baseline at e01e09e | 1 FAIL (edgetam test, Node 22 `navigator` stub): fixed in the test |

## Defect ledger (only items verified in source)
| # | Sev | Defect | Status |
|---|---|---|---|
| 1 | P1 | Async matte from a replaced provider / reset cache / old orientation could be cached and shown (`startAsyncSeg`) | FIXED, unit test `frame-epoch`; app wiring not browser-tested for the swap race |
| 2 | P1 | No tab-visibility invalidation of in-flight masks | FIXED (resume resets cache) |
| 3 | P2 | Sync path dereferenced null result | FIXED |
| 4 | P1 | Automatic promoted engines with no quality qualification | FIXED, test `engine-qualification` |
| 5 | P3 | edgetam unit test environment-dependent (Node ≥21) | FIXED |
| 6 | P1 | RVM (GPL-3.0) weights and picker option shipped in the public site build, against NEXT.md directive 3 | FIXED: `scripts/build-site.sh` excludes them unless `GENESIS_INCLUDE_GPL=1`; build with the flag verified in a browser (saved `rvm` preference falls back to MODNet, no 404 errors). Source and tests remain in the repo. |
| 7 | P2 | Local accounts are device-local (SHA-256 digest in localStorage) | OPEN, documented; not server auth |
| 8 | P2 | Signalling is mesh without TURN | OPEN, documented |
| 9 | P3 | CSS debt in genesis-system.css | PARTLY FIXED: 227 provably unused rules removed (3213 → 3172 lines), 63/63 page-viewport screenshots identical before/after. 241 `!important` remain: stripping them in groups of 120 and of 30 changed 27-59 screenshots each time, so they are structural, not removable blindly. 214 inline `style=` attrs in studio.html remain. |
| 10 | P2 | Chosen scene was not persisted: every reload reset to the default environment | FIXED (`vs_last_env`), t61 |
| — | — | Tile starvation/cache, recording cadence, watchdog on every worker, context-loss recovery, mask-age metric at composite time | NOT AUDITED |

## Security scan
No API keys, tokens or private keys found in tracked js/html/json/yml/py/md. 100 dynamic `innerHTML` assignments; interpolated ones reviewed were blob URLs, app timestamps or escaped. Not a full audit.

## Added this session
t60 responsive/a11y audit, t61 user journeys (both added to CI workflow), t62 page screenshot harness, `tools/css_usage_audit.py`, `tools/audit_controls.py`, `tools/img_diff.py`. Service-worker cache bumped to v147.

## BLOCKED
Real-human alpha benchmark (consented labelled video); physical-device matrix (`docs/DEVICE_MATRIX.md` left blank on purpose); signed release (private secrets); GitHub PR creation / CI trigger (tool got 403).

## Needs your decision
1. Automatic mode: experimental routes stay behind `vs_auto_experimental=1` (matches the brief); say if you want a visible Settings toggle.
2. RVM is excluded from distributable builds per your own directive 3; say if you hold a written licence and want it back (`GENESIS_INCLUDE_GPL=1`).
