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
| 6 | P1 | RVM (GPL-3.0) code+model shipped in public site build | OPEN: needs your licensing decision (remove vs comply) |
| 7 | P2 | Local accounts are device-local (SHA-256 digest in localStorage) | OPEN, documented; not server auth |
| 8 | P2 | Signalling is mesh without TURN | OPEN, documented |
| 9 | P3 | CSS: 710 `!important` in genesis-system.css (3213 lines), 214 inline style attrs in studio.html | OPEN, not consolidated |
| — | — | Tile starvation/cache, recording cadence, watchdog on every worker, context-loss recovery, mask-age metric at composite time | NOT AUDITED |

## Security scan
No API keys, tokens or private keys found in tracked js/html/json/yml/py/md. 100 dynamic `innerHTML` assignments; interpolated ones reviewed were blob URLs, app timestamps or escaped. Not a full audit.

## BLOCKED
Real-human alpha benchmark (consented labelled video); physical-device matrix (`docs/DEVICE_MATRIX.md` left blank on purpose); signed release (private secrets); GitHub PR creation / CI trigger (tool got 403).

## Needs your decision
1. Automatic mode: keep experimental routes behind `vs_auto_experimental=1` (current, matches the brief) or add a Settings toggle.
2. RVM: remove from the distributable build, or accept GPL-3.0 obligations.
