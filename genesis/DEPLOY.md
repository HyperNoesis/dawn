# Genesis v0.94 (segmentation-next): deploy guide
This folder IS the website. Upload its contents as-is (static hosting, HTTPS required for camera):
- Cloudflare Pages / Netlify: drag-and-drop this folder (the `_headers` file is read automatically).
- GitHub Pages: push the contents; `.nojekyll` is included. (Pages ignores `_headers`; the service worker supplies cross-origin isolation.)
- Local test: `npx serve .` or `python3 -m http.server`, then open http://localhost:8000/ (localhost counts as secure).

Open `/studio.html` (app), `/ppmatting-lab.html` (phone test lab: run MODNet baseline first, then PP-MattingV2, then live camera 10-20 min).

## What is in this build
- Automatic starts with the established local baseline (MediaPipe on constrained/mobile profiles; MODNet where supported). PP-MattingV2, Genesis Hybrid and UltraMatte remain explicit BETA/test selections and are not automatically promoted until their exact model + preprocessing + postprocessing + runtime versions pass the independent held-out human-video quality gate. RVM is not an Automatic candidate.
- PP-Matting HRNet is an opt-in "Enhance quality" export engine.
- Bundled weights: MODNet, RVM, PP-MattingV2, PP-Matting HRNet. NOT bundled: EdgeTAM data and BiRefNet-lite (the picker falls back to MODNet; fetch them with scripts/fetch-models.js in the source package).
- Licences: models/ppmatting-LICENSE-Apache-2.0.txt, ppmatting-NOTICE.txt. RVM is GPL-3.0 and needs a legal review before a closed-source paid release.

## Validation boundary
The 17 Nov 2026 checks below are historical evidence for that tree, not validation of the current branch. For the current continuation, see PR #7 and `GENESIS_FINAL_EXECUTION_REPORT.md`. Synthetic camera/model gates are integration tests, not real-person video quality or physical-device performance. Before a commercial deployment, inspect `LICENSES.md`: the RVM GPL-3.0 files are still present in the public browser distribution and require a licence/distribution decision for a closed-source paid build; research-model training-data terms also require legal review.

Historical validation on the 17 Nov tree: unit tests, Chromium e2e t46 (HRNet enhance) and t47 (lab + VideoGuard) passed; six pages loaded with no errors/missing files. Those checks did not verify real phones, 10–20 minute camera use, Safari/Firefox or WebGPU.
Evidence on still-image quality: `docs/REAL_GT_COMPARISON_2026-11-17.md` (research-only; not a video/device qualification).
