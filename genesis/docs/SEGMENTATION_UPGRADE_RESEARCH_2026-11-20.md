# Genesis segmentation upgrade research — 20 November 2026

## Executive decision

Do not replace the live matting engine with a fashionable heavyweight model yet. Genesis already has a credible mobile-oriented base (MODNet / PP-MattingV2), an uncertainty-band tile refiner (Genesis Hybrid), temporal logic, scene guards, and a separate high-quality export route. The highest-confidence next improvement is to make every inference/refinement operation frame-consistent, then close the gap between asynchronous masks and the current camera frame. Only after that should the team decide whether a new model earns its place on the target Android device.

A universal "cure" is not realistic: fine hair, motion blur, low light, transparent fabric, subject occlusion, camera noise, and thermal limits are different failure modes. Genesis should detect which failure is happening and spend computation where it helps.

## 1. Current repository assessment

Snapshot reviewed: `main` commit `6154b327` (20 Nov 2026).

- The live app uses an asynchronous segmentation path and can reuse the latest mask while drawing fresh camera frames.
- The optional Genesis Hybrid path uses PP-MattingV2 for a coarse matte, detects an uncertain boundary band, re-runs selected 192×192 crops, and optionally motion-warps / temporally blends the previous matte.
- The standalone `seg-refine/` prototype adds RGB-guided upsampling, temporal gating, and edge-colour decontamination.
- The repository already contains PP-MattingV2 and PP-Matting HRNet weights and a model picker. The hybrid path is still explicitly marked beta and unverified on real Android footage.
- Earlier segmentation reports are candid that the available quantitative results are synthetic fixtures, not a real-person, real-camera, Redmi 14C validation set.

### A concrete hybrid-path defect

Before this research patch, `GenesisHybridProvider.segment()` awaited the coarse PP-Matting inference and then passed the live `<video>` element to the high-resolution tile-refinement stage. The worker had already consumed a copy of an earlier frame. The live video may have advanced while the worker was running, so the coarse matte and the refinement tiles could describe different frames. The EdgeTAM tracker and motion-estimation pass could also read that later frame.

The branch accompanying this document snapshots the source frame **before** asynchronous inference and reuses that same snapshot for EdgeTAM, tile refinement, and motion estimation. A regression test deliberately advances the fake camera while inference is pending and checks that every tile still uses the coarse inference's source frame. The parent PP-Matting result remains the fallback if frame snapshotting fails.

This corrects frame identity in the optional Hybrid path; it does not claim to solve every segmentation defect.

## 2. Research landscape

### MatAnyone 2 — strongest near-term human-video benchmark candidate

The CVPR 2026 Highlight work focuses on practical human video matting, fine boundary detail, and robustness in difficult real-world lighting. It introduces a learned matting-quality evaluator and reference-frame cues. Its official code and checkpoints are public, so it is a realistic offline benchmark candidate.

**Constraint:** the official project uses the NTU S-Lab licence, which permits non-commercial use; commercial use requires permission. It should not become a paid Genesis default without written author permission and a separate deployment/performance review.

Official project: https://pq-yang.github.io/projects/MatAnyone2/
Code and licence: https://github.com/pq-yang/MatAnyone2

### MatAnyone-E — closest match to the architecture Genesis should evolve toward

The October 2026 MatAnyone-E work uses sparse memory propagation: it first identifies uncertain query regions at low resolution, then spends high-resolution matching only on uncertain regions and relevant memory. Its paper reports quality comparable to MatAnyone 2 with substantially lower high-resolution inference cost.

**Important caveat:** the public project page/repository currently list inference code and checkpoints as TODO. The headline FPS numbers are measured on powerful NVIDIA server GPUs, not an Android phone. It is a research blueprint, not a model we can safely drop into Genesis today.

Paper: https://arxiv.org/abs/2610.35724
Project/release status: https://github.com/Shuyun-Wang/MatAnyone-E

### VideoMaMa++ — watch for premium offline export

The NeurIPS 2026 approach passes already-produced mattes between video chunks using preserve-and-refine tokens, specifically addressing flicker and discontinuities at chunk boundaries. The official repository says the checkpoint and inference/training code are still under review. Its video-diffusion design is a better fit for a future cloud/offline export tier than for live mid-range Android preview.

Project: https://cvlab-kaist.github.io/VideoMaMa-PlusPlus/
Repository/release status: https://github.com/cvlab-kaist/VideoMaMa-PlusPlus

### SAM2Matting — broad object support, not a commercial default

SAM2Matting combines high-level video tracking with dedicated low-level matting and supports prompts beyond people. The official repository labels the release CC BY-NC-SA 4.0, so it is for non-commercial research use unless separately licensed. It is useful for technical comparison, not a drop-in paid-product dependency.

Repository: https://github.com/FudanCVL/SAM2Matting

### What is deployable in Genesis now

PP-MattingV2 is an efficient 8.95-million-parameter portrait matting model; the published PaddleSeg benchmark reports SAD 40.59 on its PPM-AIM-195 evaluation. The larger PP-Matting HRNet model reports SAD 31.56 with 24.5 million parameters. These numbers are useful for comparing model families on that benchmark, not guarantees of real-world quality or Android speed. Genesis already contains both choices and their Apache-2.0 notices.

Sources:
- https://github.com/yakhyo/ppmatting
- https://github.com/PaddlePaddle/PaddleSeg/blob/release/2.10/Matting/README.md

A separate MODNet LiteRT port reports about 79 ms/frame on a Pixel 8a. That is a possible native-Android runtime experiment, not proof it will run faster on Genesis's target phone. It would require a proper Capacitor/native bridge and direct comparison against the current ONNX/WebAssembly route.

Reference: https://huggingface.co/litert-community/MODNet-LiteRT

## 3. The upgrade to build

### Priority A — frame identity and mask-age compensation

1. Preserve the exact source frame for every asynchronous inference result.
2. Store that source frame (or a compact luma pyramid) beside the returned mask and timestamp.
3. Estimate motion from the inference source frame to the current camera frame at low resolution.
4. Warp the cached alpha into the current frame before compositing; use confidence gates so unreliable flow does not drag the matte.
5. If motion is too large, the scene changes, or confidence drops, reduce temporal history and request a fresh model pass.
6. Display diagnostics for mask age, flow confidence, inference time, and dropped/warped masks.

This directly addresses the stale-mask problem created by rendering fresh camera frames while asynchronous inference is pending. It should be implemented as a separate, kill-switchable stage and measured on the target phone before becoming the default.

### Priority B — sparse boundary refinement

Evolve Genesis Hybrid toward a quality-aware sparse refiner:

- Keep a low-cost coarse matte for semantic coverage.
- Build an uncertainty map using alpha ambiguity, edge gradients, temporal disagreement, and motion confidence.
- Rank boundary tiles by expected quality gain per millisecond, not only by the number of uncertain pixels.
- Re-run the best tiles with context, preserve confident interior/exterior pixels, and blend only inside a feathered uncertainty band.
- Cache a tile only while its source frame, motion alignment, and coarse matte remain compatible.
- Keep a strict time budget and stop refinement before it harms preview responsiveness.

This follows the sparse-refinement direction demonstrated by MatAnyone-E, while using Genesis's own licensed PP-MattingV2 model and code.

### Priority C — GPU edge-aware refinement

The existing `seg-refine/` prototype reports synthetic improvements: boundary error 0.238 → 0.141 with RGB-guided upsampling, static edge flicker 0.085 → 0.022 with temporal plus guided refinement, and moving-edge error 0.376 → 0.233 with gated temporal fusion. These are controlled synthetic results, not real-footage proof.

Its own README measures the CPU guided and edge-colour stages at about 17 ms and 26 ms respectively on a 640×360 Node test. Running both as full-frame CPU work would consume roughly a full 24-FPS frame budget before segmentation. Port the operations to a WebGL/WebGPU shader and restrict colour decontamination to the uncertainty band; retain the CPU path only as a reference and test oracle.

### Priority D — a properly labelled real-footage benchmark

The release gate must use the same owned/consented clips and target device for every engine. Cover:

- Curly/coily hair, flyaways, braids, backlight, and dark hair on a light background.
- Head turns, walking, fast hands, motion blur, and partial occlusion.
- Glasses, headphones, headwraps, lace, and fine fabric.
- Low light, window backlight, patterned backgrounds, and subject/background colour similarity.
- Camera restart, orientation change, tab pause/resume, and 10–20 minute thermal runs.

Label at least five keyframes per clip with ground-truth alpha. Report MAD/SAD, gradient error, connectivity error, temporal dtSSD/flicker, inference p50/p95, displayed-mask age, render FPS, memory growth, and recovery failures. The existing `tools/matting-bench/FOOTAGE_MATRIX.md` is the intended checklist; its unchecked rows are real work, not paperwork.

## 4. Release policy

- **Live mobile:** keep the lightweight, locally runnable base; add frame-aligned mask propagation and sparse edge refinement only when they pass the target-device gate.
- **Desktop / capable GPU:** expose Genesis Hybrid and higher-quality options as experimental profiles until their real-footage results are measured.
- **Offline / cloud export:** benchmark MatAnyone 2 only under a permitted non-commercial evaluation or with written commercial permission; add VideoMaMa++ only after official weights/code become available and licence terms are reviewed.
- **Never promote on synthetic tests alone.** Require real-camera footage, target-phone performance, 10-minute stability, and licence clearance.

## 5. CI and validation gap

The checked-in test workflows under `genesis/.github/workflows/` are nested below the repository root. GitHub Actions only discovers workflows under the root `.github/workflows/` directory. The root currently had deployment and Android workflows, but no root segmentation-test workflow. The companion branch adds a root workflow to execute the existing unit and Playwright regression gates on pushes and pull requests.

## Bottom line

The highest-value route is not "install the biggest model." It is:

**correct frame pairing → compensate mask age → refine only uncertain edges → GPU edge cleanup → validate on real target-device footage → only then consider a new model or training.**

That path improves the current product without forcing non-commercial research weights into a commercial build or sacrificing the live experience to an unmeasured heavyweight model.


## 6. Implementation added on the upgrade branch

Branch: `fix/hybrid-frame-pairing-nov20`.

### Frame-locked inference

- The optional Genesis Hybrid provider snapshots its input before coarse asynchronous inference and uses the same snapshot for tile inference, EdgeTAM tracking, and its motion-estimation input.
- The Studio async path snapshots the first inference frame and uses it for both the person bitmap and segmentation model input.
- The regression suite deliberately advances a fake camera while the parent inference promise is pending and checks the tile inputs stay paired with the correct source frame.

### MaskMotion v1

A new model-agnostic stage is loaded before the Studio app:

- `js/providers/mask-motion.js` samples each source frame into an aspect-preserving luma grid 64 pixels wide (for example 64×48 at 4:3, 64×36 at 16:9, and 64×114 in portrait).
- It estimates small block-level backward motion, with texture, residual and match-separation confidence.
- It warps the cached soft alpha with bilinear sampling between model refreshes.
- It refuses alignment on low texture/confidence, scene cuts, frame gaps, or masks older than 1.5 seconds after delivery. A rejected alignment suspends propagation until a new model matte is seeded.
- The implementation is optional and fail-soft. Set `localStorage.vs_mask_motion = "0"` or use the Diagnostics toggle to disable it. The base model mask remains available.
- Diagnostics publish alignment status, mask age, mean confidence, coverage and propagation-stage cost.

The current search radius is deliberately small (2 analysis-grid pixels) to bound CPU cost; this is not dense optical flow and may refuse to align fast motion or low-texture footage.

### Automated coverage added

- `tools/e2e/unit_mask_motion.js`: controlled translation, static-scene stability and low-texture refusal.
- `tools/unit/hybrid-provider.test.js`: coarse/refinement frame pairing under simulated asynchronous camera advancement.
- The root workflow runs all `tools/e2e/unit_*.js` files and the existing browser/model gates.

### Validation status and limitations

Passing pure-logic and synthetic motion tests is necessary but insufficient. The browser gates, export checks and site build still need to pass on the current branch. No target Android device, consented real-person footage, labelled hair/finger alpha set, thermal session, or commercial licence audit has been completed here.

Do not describe MaskMotion as a new segmentation model or as a solution to missing upstream alpha detail. It only aligns an already-produced matte during short asynchronous gaps. It cannot reconstruct strands the model never detected, repair a completely wrong subject mask, or recover transparency from a single ambiguous frame.


### Fail-safe compositing

If MaskMotion detects a scene cut, long capture gap, or expired matte, the renderer temporarily passes through the real camera instead of compositing an obviously stale silhouette onto a new scene. A fresh model result reseeds the matte and returns to cutout mode. Low-confidence motion does not cause a guessed warp; it holds the unwarped base matte while waiting for the next inference.


### Inference delivery-time accounting

MaskMotion keeps two clocks separate: the original camera timestamp is retained for the first source-to-current motion estimate, while mask staleness begins when the model result is delivered, not when inference started.

The source-frame catch-up window is 1.2 seconds and the maximum matte lifetime after delivery is 1.5 seconds. The flow search remains local and conservative; if a large movement cannot be matched confidently, propagation suspends instead of guessing.


### User-facing engine name

The existing opt-in `genesis-hybrid-tam` engine is now presented in the picker as **Genesis UltraMatte**. It combines the local PP-MattingV2 coarse alpha, EdgeTAM subject gate, uncertainty-band high-resolution tile refinement, and the app-level MaskMotion stage. The underlying engine identifier is preserved for backward compatibility. This remains a beta profile and is not automatically promoted on low-tier devices.


### Async recovery guard

Background matte refreshes now pass through the same segmentation watchdog used by the main inference path. A worker that stops responding is counted as a stall and cannot leave the async refresh state permanently busy; the existing quality governor can then recover or downshift the engine.


### Aspect-preserving flow geometry

The motion-analysis grid now derives its height from the source camera aspect ratio on every seed/read. This prevents portrait and 4:3 footage from being distorted into a fixed 16:9 motion field; unit tests cover 4:3, 16:9 and portrait geometry.
