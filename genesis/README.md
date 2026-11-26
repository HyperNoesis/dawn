# Genesis Studio

Browser virtual studio (cutout, scenes, broadcast tools) plus an optional GPU service for clean, flicker-free exports. This repository is the single source of truth: pushing to `main` redeploys the website and, if configured, the GPU service.

## What is where
| Path | What |
|---|---|
| `index.html`, `js/`, `css/`, `assets/`, `models/`, `vendor/`, `sw.js`, `manifest.json`, `_headers` | The website (a static PWA). `sh scripts/build-site.sh` puts the deployable copy in `www/`. |
| `gpu/` | **Studio Export on Modal** (serverless GPU, scales to zero): `modal_app.py`, `export_api.py`, tests, Colab benchmark notebook. |
| `server/studio-export/` | The export engine (BiRefNet matting, optical-flow temporal fusion, scene integration) and its tests. `fetch_models.sh` downloads the models from GitHub. |
| `server/` (other) | Signaling server, render relay and worker (older, optional). |
| `.github/workflows/` | `pages.yml` website, `modal-deploy.yml` GPU service, `python-tests.yml` export tests, `tests.yml` browser gates, `android.yml` APK. |
| `docs/` | Architecture, handoffs, licences, **`DEPLOY_FROM_PHONE.md`** (start here to deploy). |
| `android/`, `supabase/`, `tools/`, `scripts/` | Android wrapper, optional accounts backend, test tools, build scripts. |

## Deploy in three steps (all doable from a phone browser)
1. **Website:** repo Settings, Pages, Source = GitHub Actions. Push to `main` and it publishes at `https://<owner>.github.io/<repo>/`.
2. **GPU service:** add three Actions secrets (`MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `GENESIS_EXPORT_TOKEN`) and run the "Deploy GPU export (Modal)" workflow.
3. **Connect them:** put the printed URL and the token in `js/config.js` (`renderRelayUrl`, `renderRelayToken`, `renderRelayLabel`).

Full click-by-click guide, costs and safety limits: [`docs/DEPLOY_FROM_PHONE.md`](docs/DEPLOY_FROM_PHONE.md).

## Models
Nothing over 100 MB is on `main` (GitHub blocks it). **The four heavy models are also stored in this repo**, on the `models` branch, split into 90 MB parts (`sh restore.sh` there joins and verifies them); `fetch_models.sh` falls back to that branch automatically if an original release link disappears. The export models (BiRefNet matting and portrait, BiRefNet general ONNX, MatAnyone 2 reference) are pulled from their GitHub releases at pinned versions and SHA-256-checked by `server/studio-export/fetch_models.sh`; the Modal image build runs it, so cold starts download nothing. The browser stack includes MODNet and MediaPipe as bootstrap/fallback paths, plus PP-MattingV2 and EdgeTAM for the Advanced Adaptive live route. RVM and BiRefNet remain explicit opt-ins, not members of the automatic promotion chain.

## Live segmentation default

**Automatic currently starts from the established local baseline** (MediaPipe on constrained/mobile devices and MODNet where the device/profile supports it). It does not automatically promote PP-MattingV2, Genesis Hybrid or Genesis UltraMatte because no exact-version route has yet passed the independent, rights-cleared, held-out human-video qualification gate. Those routes remain explicitly selectable BETA engines for testing. A future approved route must match its model, preprocessing, postprocessing and runtime identity; only then may measured device P75/P95 performance choose among qualified routes.

This is intentionally more conservative than a timing-only promotion policy. Synthetic browser tests verify integration and regression behaviour, not human hair/finger alpha quality. RVM is not an Automatic candidate and remains GPL-3.0; BiRefNet is optional and its training-dataset rights remain a legal review item. **Genesis MatteNet remains a specification only: it has no trained custom weights and is not a live engine.**

## Licences, read before selling anything
See `LICENSES.md`. In short: BiRefNet is MIT. **MatAnyone 2 is non-commercial** and excluded from the GPU image by default; only opt in with `GENESIS_INCLUDE_REFERENCE=1` for permitted reference evaluation. Never use it in a paid workflow without written permission. **RVM in the browser live tier is GPL-3.0**: fine for testing, replace before you charge anyone (plan in `docs/MODEL_DECISION_v0_82.md`). SAM2Matting is non-commercial and is not used.

## Tests
CI runs provider/pure-logic unit suites, Playwright synthetic-camera and model-inference gates, motion/matte-edge regression checks, Python export/scene/safety tests, export API tests, and a deployable-site build. The test artifacts include paired segmentation/composite images and numeric mask/temporal metrics. Synthetic fixtures verify integration and regression behavior; they are not independent real-person accuracy labels.

## Status
The adaptive implementation has passed earlier browser/model, export/API and site-build CI runs. The latest branch run is linked from the pull request. **Still unverified:** hand-labelled real-person alpha quality, sustained performance/thermal/memory behavior on physical Android/iOS devices, and a production GPU export. The physical-device and real-footage gates remain release blockers; see `docs/BLIND_TEST.md` and the device validation notes.
