# Genesis MatteNet — research and implementation specification

**Status: specification only. No training run, custom weights, or mobile-quality claim is made here.**

## Objective
Build a compact, commercially deployable temporal human-matting model for Genesis. It must output continuous alpha and preserve fine hair, finger gaps, glasses, thin fabric, motion blur and partially transparent boundaries while maintaining stable subject identity through motion and occlusion.

## Proposed architecture
A shared mobile encoder feeds four heads:
1. **Subject/semantic head:** identity and coarse foreground support.
2. **Alpha head:** multi-scale continuous alpha prediction.
3. **Uncertainty head:** calibrated error likelihood trained against held-out annotation error. It must be calibration-tested, not assumed trustworthy.
4. **Temporal state/head:** compact recurrent or feature-memory path with explicit scene-cut, subject-loss and re-entry resets.

A small boundary decoder uses shallow high-resolution features and coarse alpha/uncertainty maps. Prefer adaptive ROI/features over a full-resolution encoder. Foreground-colour recovery remains a separate compositing stage.

## Training and data rights
- Use only footage, annotations and teacher models cleared for the intended use.
- Record provenance, consent or another documented lawful basis, attribution, retention limits and permitted uses for every clip.
- Do not use MatAnyone 2 or SAM2Matting outputs for commercial distillation without separate written permission explicitly covering that use.
- Review GPL-licensed RVM obligations before using its code, weights or labels in a closed commercial pipeline.
- Split by participant and source clip, never by neighbouring frames.
- Final test labels must be independent ground truth; teacher agreement is not a substitute for a quality benchmark.

Include varied hair, skin/background contrast, backlight, low light, glasses, hands, fingers, thin fabric, motion blur, camera movement, occlusion, multiple people and scene cuts. Label sequences with documented frame alignment.

## Training objectives
Combine alpha L1/SAD, MSE, gradient/edge, connectivity-aware, motion-compensated temporal consistency and uncertainty-calibration losses. Avoid forcing stale history through scene cuts or onto newly appearing hands. Weight fine detail without hallucinating foreground.

## Deployment sequence
1. Establish a reproducible float32 baseline using rights-cleared data and the tools/matte-bench evaluator.
2. Distil a compact student and evaluate on subject-held-out splits.
3. Export ONNX and test numerical parity with the training runtime.
4. Quantise after identifying sensitive layers; compare INT8/FP16 quality.
5. Benchmark WebGPU where supported and WASM fallback across sustained phone sessions, memory and thermal conditions.
6. Promote only after independent quality and physical-device gates both pass.

Do not invent a model size or FPS target before measuring the quality/latency Pareto curve on target hardware.
