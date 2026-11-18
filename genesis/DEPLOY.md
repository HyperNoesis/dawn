# Genesis v0.94 (segmentation-next): deploy guide
This folder IS the website. Upload its contents as-is (static hosting, HTTPS required for camera):
- Cloudflare Pages / Netlify: drag-and-drop this folder (the `_headers` file is read automatically).
- GitHub Pages: push the contents; `.nojekyll` is included. (Pages ignores `_headers`; the service worker supplies cross-origin isolation.)
- Local test: `npx serve .` or `python3 -m http.server`, then open http://localhost:8000/ (localhost counts as secure).

Open `/studio.html` (app), `/ppmatting-lab.html` (phone test lab: run MODNet baseline first, then PP-MattingV2, then live camera 10-20 min).

## What is in this build
- Default segmentation is UNCHANGED: Auto -> MODNet/RVM/MediaPipe. PP-MattingV2 is a BETA in the engine picker (kill switch: flags.json ppmattingBeta = 0). Do not set promotePPMatting = 1 before the phone gate passes.
- PP-Matting HRNet is an opt-in "Enhance quality" export engine.
- Bundled weights: MODNet, RVM, PP-MattingV2, PP-Matting HRNet. NOT bundled: EdgeTAM data and BiRefNet-lite (the picker falls back to MODNet; fetch them with scripts/fetch-models.js in the source package).
- Licences: models/ppmatting-LICENSE-Apache-2.0.txt, ppmatting-NOTICE.txt. RVM is GPL-3.0 and needs a legal review before a closed-source paid release.

## Verified on this exact tree (17 Nov 2026)
Unit tests pass; real-Chromium e2e t46 (HRNet enhance) and t47 (lab + VideoGuard) pass; six pages load with 0 errors and 0 missing files. Not verified: real phones, camera for 10-20 min, Safari/Firefox, WebGPU.
Evidence on still-image quality: docs/REAL_GT_COMPARISON_2026-11-17.md (in the source package).
