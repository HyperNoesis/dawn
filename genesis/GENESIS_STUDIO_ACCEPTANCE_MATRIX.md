# Genesis Studio acceptance matrix

**Execution date:** 26 November 2026  
**Source:** live `genesis/studio.html` and the final execution brief.  
**Status convention:** PASS requires a reproducible test artifact; BLOCKED requires unavailable hardware/data/credentials; NOT RUN means no verification was performed.

## Studio surface inventory

The live Studio shell exposes 17 tool tabs. The presence of a tab/control is not proof that its complete user journey works.

| Surface | Core acceptance | Execution status |
|---|---|---|
| Scene | Select environment, upload custom background, create/restore a scene | NOT RUN — full browser journey not executed |
| Looks | Grade/light/blur/depth/effects change actual composite and persist | NOT RUN |
| Show | Run-of-show, overlays, graphics and templates render consistently | NOT RUN |
| Audio | Device selection, levels, chain, mute, recording sync and cleanup | NOT RUN |
| Camera | Permission denial, device switch, front/back, stop/restart and track end | NOT RUN — physical-device lifecycle not executed |
| Framing | Aspect, zoom/pan, guides and restore | NOT RUN |
| Realism | Light/shadow/depth/blur controls affect actual output | NOT RUN |
| Mask | Engine selection, Automatic, inspector, correction and fallback truth | PARTIAL — qualification gate and provider-generation guard added; full user journey NOT RUN |
| Graphics | Lower-thirds, banners, tickers, QR and overlays in preview/export | NOT RUN |
| Prompter | Script, pace, controls and supported voice-follow behaviour | NOT RUN |
| Captions | Permission/model limits, caption rendering and recording consistency | NOT RUN |
| Content | Slides/content upload, preview and output consistency | NOT RUN |
| Presets | Preset apply/reset and persisted values | NOT RUN |
| Quality | Resolution/quality presets and device-tier behaviour | NOT RUN |
| Recordings | Record, stop, save, replay, rename, delete and recovery | NOT RUN |
| Go Live | WHIP setup, network loss, disconnect and media cleanup | BLOCKED — external endpoint/credentials and network validation not supplied |
| Advanced | Diagnostics, exportable reports and advanced state controls | PARTIAL — source-frame diagnostic status exposed; complete interaction audit NOT RUN |

## Required journeys

| Journey | Status | Evidence / blocker |
|---|---|---|
| Fresh guest: privacy, preview, grant permissions, record, save, download, find in Projects | NOT RUN | Requires real browser execution and test media |
| Returning user: restore scene/projects/devices without duplicates | NOT RUN | Requires persistence and browser E2E |
| Camera failure: deny, revoke, switch, rotate, background/resume | BLOCKED | Requires physical browser/device test |
| Long recording with movement and audio/video sync | BLOCKED | Requires sustained capture session and output playback inspection |
| Edit/export, cancel/retry and cleanup | NOT RUN | Export pipeline E2E not run in this execution |
| Go Live and connection teardown | BLOCKED | Requires configured WHIP endpoint and credentials |
| Responsive phone/tablet/desktop, keyboard and reduced motion | NOT RUN | Full responsive/accessibility sweep not run |

## CI evidence at execution start

- Android debug job on PR #5 head `e01e09e`: PASS (GitHub Actions run 45583194793).
- Segmentation workflow on PR #5 head `e01e09e`: CANCELLED during Python test dependency installation (run 45583194549); subsequent service, syntax, unit, browser, export and site-build steps were skipped.
- The UltraMatte browser gate uses a synthetic camera fixture. It is not a real-human or physical-phone qualification.

This matrix is intentionally conservative. Replace statuses only when the corresponding command, environment, commit SHA and test artifact are available.

## Visual system and CSS audit

- The shared `css/genesis-system.css` is currently approximately 263 KB and declares a Genesis token system with purple brand/action accents, cyan intelligence accents, amber warning/warm accents, success and danger roles, dark layered surfaces, motion and focus tokens. The multi-colour system already exists; a new parallel palette was not added.
- The stylesheet comments describe a compatibility foundation and retained feature selectors; `studio.html` includes one 308-character style block and 214 inline `style=` attributes. These require a selector/inline-style dependency map before retirement.
- No desktop/tablet/narrow-phone screenshots or visual-diff artifacts were produced in this environment. CSS was not mass-deleted or rewritten without those visual regression artifacts; this is NOT RUN / BLOCKED, not a visual sign-off.
- `studio-ux.js` groups the existing 17 tabs into Set / Perform / On screen / Output / Advanced, leaves unknown future tabs reachable, adds progressive disclosure and derives the first-run guide/readiness chips from state. That code is present, but its complete keyboard, screen-reader, reduced-motion and touch journeys were not re-executed here.


## CI evidence — synthetic integration only

On commit `a46fd4c545418fe6216edba4c565b98d2d50e692`, segmentation workflow run [45847956492](https://github.com/HyperNoesis/dawn/actions/runs/45847956492) completed successfully:
- protected service tests, JavaScript syntax and provider/pure-logic tests: PASS;
- synthetic camera/model/motion/matte-edge browser gates: PASS;
- export safety/API regression suite: PASS;
- deployable PWA site build: PASS.

The artifact records 3.47 sample FPS in the generic camera gate (28 frames / 8.07 sec) and the UltraMatte 10-frame synthetic gate records P50 464 ms, P75 602 ms, P95/max 2,790 ms (estimated 1.66 mask updates/sec at P75). The cartoon presenter/ground-truth fixture is synthetic only. It is a code-path integration check, not proof of hair/finger alpha quality or a mobile performance score.

The camera gate captures the first stats string immediately after camera Start (0 FPS / 1,495 ms), then switches scene, waits 3 seconds and records later app stats (about 4 FPS / 375 ms). These readings are from different warm-up stages, not simultaneous contradictory telemetry. The separately measured 8.07-second preview sample averaged 3.47 FPS, well below the 24 FPS objective; the test is synthetic Chromium, not a target-device performance result. Full Studio surface journeys remain NOT RUN.

