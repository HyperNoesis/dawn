# Physical-device segmentation validation

CI's synthetic-camera Chromium gate verifies integration, weight loading and known-fixture behaviour. It cannot replace a real camera or physical-device quality/performance evaluation.

## Protocol
Test the built PWA and Android/WebView build on each target. Include Redmi 14C as a low-resource target, another low-end Android device and a desktop reference when available.

For each device record: exact device/RAM/Android/browser version and Genesis commit; selected preset and active model; camera/matte/output resolution and lighting; cold start, model initialisation and time to first valid cutout; sustained FPS and latency P50/P95; fallback events, worker errors and crashes; process memory, battery change and thermal throttling; quality on hair, finger gaps, glasses, thin fabrics, fast hands, backlight, dark/low-contrast subjects, camera motion, occlusions, scene cuts and recovery.

Use at least three runs per device. Each includes a 15–30 minute live session, plus cold-start and warm/offline-start checks. Do not compare FPS across different resolutions without recording the difference.

## Evidence package
Save a short screen recording, paired original/raw-alpha/final-alpha/checkerboard samples, JSON/CSV metrics, device/build manifest and limitations. Only record/upload participant footage with consent; keep private footage out of public issues and CI artifacts. Use independent aligned alpha labels with tools/matte-bench/evaluate.py for quantitative metrics.

## Release rule
Do not label a device as passed unless evidence exists. A synthetic CI pass, software-rendered browser timing or brief preview is not sustained phone proof.
