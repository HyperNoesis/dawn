# Genesis UltraMatte 2 — engineering foundation and release plan

Status date: 20 November 2026

## What this branch changes

This branch hardens the existing browser matting system. It does **not** claim to have trained or integrated a new state-of-the-art matting network.

### 1. Engine routing is isolated by provider

matte-engine-policy.js defines the scripts and runtime symbols required by each provider independently. PP-MattingV2 no longer needs BiRefNet or EdgeTAM to be present. Genesis Hybrid only needs PP-MattingV2 and the boundary-refinement modules. Genesis UltraMatte with tracking additionally needs EdgeTAM.

The router now waits for its dynamic module load before camera startup. A selected advanced provider is either constructed or fails with an explicit error; it is not silently replaced by MODNet inside the router. The app may still move to MediaPipe after an initialisation failure or a measured performance failure, but the active engine and reason are reported.

A deliberate advanced-engine selection also takes priority over automatic RVM probing. This prevents a separate automatic candidate from replacing the engine the user selected.

### 2. UltraMatte refinement receives an independent budget

Previously the refinement allowance was calculated as targetMs minus coarseInferenceMs. If the coarse model took longer than the target, the detail stage received zero tiles indefinitely.

The new budgetMs API treats the tile allowance as incremental work. It is still capped by a maximum tile count and an EWMA estimate of tile cost. The older total-frame API remains supported for existing callers.

### 3. Tile reuse is safer and fairer

A cached tile is refreshed when any of the following is true:
- its coarse alpha changes materially;
- its low-resolution source-frame signature changes;
- it exceeds the maximum cache age.

The source signature is sampled from the same frame snapshot used by the coarse matte and the tile refiner. This catches some appearance changes that a coarse-alpha-only comparison misses.

Tile scheduling gives never-refined and older tiles priority. That prevents the same high-activity regions from taking every available tile slot. A conservative initial per-tile estimate and an occasional one-tile probe prevent a pessimistic first estimate from starving the entire refinement stage.

The performance governor now recognises Genesis Hybrid / UltraMatte and EdgeTAM-wrapped providers as distinct engines. It rebuilds the same pipeline when resizing, and retries the explicitly selected advanced engine after a temporary lightweight fallback instead of silently recovering into unrelated MODNet.

Tile sanity checks now compare contradictions against the number of confident pixels, not the entire tile area.

### 4. Live matte inspection

Studio Diagnostics now offers Original, Alpha and Edges previews. The alpha preview is an opaque grayscale representation of the actual provider mask; white means foreground and black means transparent. The edge view highlights soft-alpha pixels and local alpha transitions.

The diagnostics panel also reports:
- selected high-quality engine;
- actually active engine;
- fallback reason;
- model long edge;
- hybrid boundary tiles, budget, cached tiles and boundary-band coverage;
- hybrid errors.

The inspector offers Original, Alpha, Edges and Checkerboard Cutout modes. The checkerboard view composites the source frame through the provider alpha, making holes and retained-background errors easier to see. Diagnostic canvases are only generated while the inspector is expanded, so ordinary sessions do not pay for their pixel readback.

The preview is a downsampled diagnostic visual only. It is not used as the recording output and does not alter the mask.

### 5. Clean-plate validity

Genesis already had an empty-room capture control and a GPU clean-plate assist. This branch improves the validity contract: the renderer reports whether a plate is actually loaded; a new output-size change invalidates the plate with a reason; and camera changes, camera stop/restart, zoom and pan clear the old reference. The Studio UI reflects the real plate state rather than leaving a stale “saved” message visible.

Lighting and physical background changes cannot be detected reliably from the existing implementation. The UI continues to instruct the user to recapture when lighting or the room changes.

## What is intentionally not claimed as complete

The following still require a separate model and validation effort:

1. A dedicated learned high-resolution boundary refiner. The current hybrid still re-runs PP-MattingV2 on small crops; this is not a new hair-specialist network.
2. A learned boundary-quality evaluator and uncertainty model.
3. A recurrent, learned temporal matting network beyond the current model-specific temporal logic.
4. Dedicated high-resolution hand and hair refinement.
5. A clean-plate/background-conditioned model. A captured empty-room frame is only useful when the camera and background are sufficiently stable.
6. End-to-end quality evidence from real camera footage on target phones.

No synthetic fixture or unit test can establish that these outstanding capabilities work on real hair, hands, motion blur or backlit scenes.

## Research architecture to pursue

The design separates five responsibilities:

1. **Subject tracking:** maintain target identity and rough spatial extent.
2. **Full-frame human matting:** predict a continuous alpha matte from the full camera frame.
3. **Boundary quality and ROI refinement:** predict which areas are unreliable, then refine hair, fingers and other fine structures with a dedicated model.
4. **Temporal reasoning:** use motion-aware memory, occlusion handling and scene-cut resets without leaving stale edges behind.
5. **Foreground reconstruction and compositing:** recover plausible foreground colour near translucent edges, then composite without halos.

Relevant research references:

- MatAnyone 2 (CVPR 2026 Highlight): learned matting-quality evaluation and long-range reference-frame cues. The released project should be assessed for its exact licence before integration: https://pq-yang.github.io/projects/MatAnyone2/ and https://github.com/pq-yang/MatAnyone2
- SAM2Matting (ECCV 2026): separates high-level target tracking from ROI detection and progressive fine-detail matting. Its repository states CC BY-NC-SA 4.0 non-commercial terms, so it is a research reference unless permission is obtained: https://github.com/FudanCVL/SAM2Matting
- CineMatte (CVPR 2026 Findings): conditions matting on a separately captured background and uses cross-attention plus image-guided feature upsampling. This motivates a future Clean Plate mode, but the paper does not constitute a ready-to-ship browser implementation: https://openaccess.thecvf.com/content/CVPR2026F/html/He_CineMatte_Background_Matting_for_Virtual_Production_and_Beyond_CVPRF_2026_paper.html
- PP-MattingV2 upstream inference reference: https://github.com/PaddlePaddle/PaddleSeg/tree/release/2.10/Matting

## Release gate

Do not promote any experimental engine to the recommended default until it passes all of the following on real footage and representative target devices:

| Gate | Proposed target |
|---|---|
| Sustained preview | At least 24 FPS where device capability permits |
| Tail latency | P95 matting inference no greater than 41.7 ms for a 24 FPS inference target, or clearly label the mode as slower |
| Hair and fingers | Human-reviewed pass on diverse real recordings |
| Temporal quality | No material regression in frame-to-frame alpha stability relative to the current approved engine |
| Recovery | No stuck mask after subject loss, camera restart, orientation change or scene cut |
| Memory | No unbounded growth in a 10-minute session |
| Fallback | Selected / active provider and fallback reason are visible |
| Privacy | Camera frames remain local unless a separately disclosed export service is explicitly invoked |
| Licensing | Code, weights and training datasets individually reviewed before commercial release |

Benchmark clips must include loose hair, curly hair, thin straps, finger gaps, glasses, fast head turns, hands crossing the face, backlighting, low light, dark clothing, textured clothing, similar foreground/background colours, partial occlusion and subject reacquisition.

Measure alpha quality (SAD / MSE), boundary gradients, connectivity, temporal stability (including dtSSD where a valid reference is available), boundary F-score, P50/P95 latency, sustained FPS, memory growth and recovery failures. Do not infer a quality score from one screenshot or from FPS alone.

## Verification required

New unit tests cover:
- per-engine dependency isolation and missing-dependency reporting;
- incremental tile budgets and legacy budget compatibility;
- rejecting a tile that contradicts confident alpha pixels.

These tests are wired into the repository's existing tools/unit/run-all.js discovery convention. The branch still needs its CI run, a production build and hands-on browser/device validation before merge or deployment.
