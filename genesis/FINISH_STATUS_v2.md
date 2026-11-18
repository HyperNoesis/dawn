# Update 17 Nov 2026: measured on real ground truth
See docs/REAL_GT_COMPARISON_2026-11-17.md. Stills: PP-MattingV2 ~3x and HRNet ~4x lower error than MODNet (11-image fair subset), RVM in between. Still unproven: video flicker, phone fps/heat, other datasets, licence review. promotePPMatting stays 0 until the phone gate passes.
Suggested next decision: use PP-MattingV2 (fast) / HRNet (quality) for still cut-out and export; keep MODNet default for live until the phone lab run.
