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
