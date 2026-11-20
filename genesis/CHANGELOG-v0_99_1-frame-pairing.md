# v0.99.1 — Hybrid frame pairing

## Fixed

- Genesis Hybrid now snapshots the camera frame before starting asynchronous PP-MattingV2 inference.
- The same snapshot is supplied to EdgeTAM tracking, high-resolution tile refinement, and motion estimation.
- If frame snapshotting fails, the hybrid stage safely returns the parent PP-Matting matte rather than refining against a newer camera frame.
- Added a regression test that advances the fake camera while inference is pending and verifies that tile inputs remain paired with the coarse inference frame.
- Bumped the service-worker shell cache to v134 so installed clients fetch the updated provider.

## Validation status

The regression test is included in the branch. The new root GitHub Actions workflow runs the existing unit and Playwright gates; production promotion remains dependent on that workflow and target-device validation.

## Scope

This fixes a frame-identity defect in the optional Genesis Hybrid provider. It does not establish real-person hair quality, Android performance, or production-complete segmentation.
