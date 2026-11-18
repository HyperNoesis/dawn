# Matte engines (v0.93)

Pick one in the studio: Tools > Segmentation model > **High-quality engine**. Default is unchanged (MODNet).

| Engine | What it does | Download | Licence | Runs where |
|---|---|---|---|---|
| MODNet (default) | live matte | already bundled | Apache-2.0 | every phone |
| MODNet + EdgeTAM cleanup | EdgeTAM finds the person; stray blobs of the MODNet matte (second person, chair, lamp) are dropped. Whole blobs only, so it never cuts holes and keeps MODNet's soft hair. Refreshes every 8 frames in the background. | ~31 MB (fp16, WebGPU) or ~40 MB (fp32, CPU) | Apache-2.0 | phones and desktop |
| BiRefNet lite | best edges, 1024x1024 network, smoothed over time by `temporal-mask.js` | ~115 MB | MIT | needs WebGPU; desktop-class GPU for live use |

Not browser models (GPU server / research only, listed in `models/registry.json`): MatAnyone 2 and SAM2Matting (non-commercial licences), SAM 2.1 / EdgeTAM PyTorch checkpoints, Depth Anything V2 Small.

## Weights
`models/registry.json` is the list (URL, size, SHA-256, licence). `node scripts/fetch-models.js` downloads and verifies them
(`--list`, `--all`, `--only a,b`, `--dest dir`, `--check`). `scripts/build-site.sh` runs it into `www/models`, so a normal Pages deploy ships them.
Weights are not committed (`.gitignore`). `make-www.js` skips `*.onnx_data`; the fetch step is what puts EdgeTAM's data files in the site.

## What was verified (and what was not)
- Verified with real weights: file hashes; EdgeTAM encoder + decoder on a real portrait (onnxruntime, Python); the JS prompt/tensor code against that
  real model; in a real Chromium: real MODNet + real EdgeTAM on the CPU (wasm) path removed an injected stray blob (4489 -> 0 px) while changing the person by 0.05%;
  picker -> router -> `new VS.MODNetWorkerProvider()` returns the wrapped engine; the downloader (resume, corruption recovery); ModelStore (size, hash, progress).
- NOT verified: anything on a real WebGPU device (the sandbox only has a software adapter and even the existing MODNet WebGPU path cannot start there);
  BiRefNet-lite inference at 1024 (tensor names/shapes and the resampling code are checked; a full run ran out of memory in the 4 GB sandbox);
  speed on phones; the temporal smoothing on real video (unit-tested only).
- Browser downloads of the GitHub release URL are usually blocked by CORS, so the models must be served from the same site (the build step does this).

## Switching off
Choose "MODNet (default)". If an engine cannot load, the app silently uses MODNet.
