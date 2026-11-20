# genesis-seg-refine v1

Model-agnostic refinement layer for live human matting. Put it after ANY matting model
(PP-MattingV2, MODNet, ...). Pure ES modules, no dependencies. Standalone: merge into Genesis later.

## Use
```js
import { SegmentationRefiner, composite } from './src/pipeline.js';
const refiner = new SegmentationRefiner();          // all stages on
// every camera frame:
const { alpha, fg, diag } = refiner.process(
  { data: rgba, width: W, height: H },              // camera frame (Uint8ClampedArray RGBA)
  { data: modelAlpha, width: wl, height: hl },      // model soft alpha, Float32 [0,1], same aspect
  performance.now());
const out = composite(fg, alpha, newBackgroundRGBA, W, H);
// refiner.reset('camera-restart') on camera restart / tab resume
// diag.reset tells you why state was dropped: init|gap|scene-cut|re-entry|size-change
```
Ablation: `new SegmentationRefiner({ stages: { temporal:true, guided:true, edgeColor:false } })`.

## Stages
1. **Temporal fusion** (`temporal.js`) - gated blend of previous and new alpha. Alpha changes where the
   image did NOT change are model noise and are smoothed; image motion opens the gate (no trails).
   Hard resets: init, size change, >250 ms gap, scene cut (mean |dRGB| > 0.18), re-entry after empty frames.
2. **Colour guided upsample** (`guided.js`) - snaps low-res alpha to full-res image edges using a
   3-channel guided filter. A luma-only guide is included but fails on equal-brightness edges (see results).
3. **Edge colour cleanup** (`edgecolor.js`) - estimates local background colour from alpha~0 pixels,
   solves F=(I-(1-a)B)/a on the edge band, leans on nearby solid foreground colour at low alpha.

## Run tests
`node test/run.mjs`  (synthetic scenes; asserts each stage earns its place)

## Synthetic results (640x360 frame, 160x90 model, jittery noisy fake model)
| Test | Baseline | This module |
|---|---|---|
| Edge error vs ground truth (static) | 0.238 bilinear | 0.141 colour-guided (-40%); luma guide 0.287 (worse) |
| Edge flicker (static) | 0.085 raw | 0.032 temporal; 0.022 temporal+guided |
| Moving subject, edge error | 0.376 heavy EMA, 0.301 EMA 0.5 | 0.233 gated (raw 0.238) |
| Scene cut | heavy EMA ghosts (0.432) | reset fires, 0.230 |
| Re-entry | - | reset fires, no ghost |
| Halo on uniform bg, edge RMSE | 11.96 naive | 1.06 |

## Limits (read before trusting)
- Synthetic evidence only. Must be re-run on real consented clips; thresholds are starting hypotheses.
- No motion compensation: fast sub-frame motion relies on the image-motion gate, not optical flow.
- Edge colour: B is a local estimate. Busy/gradient backgrounds are only partly corrected; the true
  foreground colour behind semi-transparent hair cannot be recovered from one frame.
- CPU reference cost at 640x360 (Node): guided ~17 ms, edge colour ~26 ms, temporal <1 ms. In the
  browser run guided/edge colour as WebGL/WebGPU shaders, or limit edge colour to the alpha band.
- Guided filter eps/radius (r=2, eps=1e-3) are untuned on real footage.
