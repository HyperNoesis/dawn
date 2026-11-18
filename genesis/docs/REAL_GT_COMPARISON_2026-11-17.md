# Real ground-truth comparison, 17 Nov 2026 (stills, CPU onnxruntime)

Data: 12 real portrait photos with human-annotated alpha, from the P3M demo samples (JizhiziLi/P3M, research/non-commercial licence, faces blurred). TEST ONLY, not shipped, images not included here.
Same inputs for every engine, models as shipped in Genesis (MODNet 512, RVM 512, PP-MattingV2, PP-Matting HRNet-W18). Metric: MAD x1000 vs ground truth (lower is better).

## All 12 images
| Engine | MAD | Edge-band MAD | Gradient err | CPU ms/img |
|---|---|---|---|---|
| MODNet | 18.82 | 70.99 | 24.79 | 613 |
| RVM | 17.07 | 72.66 | 28.24 | 240 |
| PP-MattingV2 | 8.92 | 33.18 | 18.86 | 375 |
| PP-Matting HRNet | 6.89 | 33.93 | 18.35 | 2859 |

## Fair subset: 11 images (drops p_71bcce3a, whose ground truth excludes a sculpture the models keep)
MODNet 13.07 | RVM 8.68 | PP-MattingV2 4.34 | HRNet 2.96

## Findings
- PP-MattingV2 and HRNet are clearly better than MODNet and RVM on real portrait stills with ground truth (about 2-3x lower error; 12 images, 1 dataset).
- PP-MattingV2 has a false-blob failure (p_bac3c1ff: stray shapes in the background, MAD 13.9 vs 1.2 HRNet). Keeping only the main subject region cuts V2 from 4.34 to 3.14 on the fair subset, but that assumes ONE subject and would delete other people in group shots. Experiment only, not wired in.
- NOT shown: video/temporal quality, phone speed, hair-level detail (no hair-specific labels), other datasets. Possible training-data overlap between PP-Matting models and P3M is unverified.
- CPU timings are not phone timings.

# Addendum (same day): second dataset, hair, subject cleanup
## Second dataset (non-human stress test, 11 images: 10 fur/glass crops from Deep-Image-Matting samples + pymatting lemur; ground-truth alpha)
Not a fair person-matting test (the models are trained on people); it checks fine-detail behaviour. Mean MAD x1000: MODNet 317 | RVM 458 | PP-MattingV2 127 | HRNet 171. Lemur (real fur photo): PP-V2 5.8, HRNet 5.6, MODNet 13.9, RVM 349 (RVM fails). PP-MattingV2 is best again; everything is much worse than on portraits.
## Hair / semi-transparent pixels (P3M, 12 images, GT alpha 0.05-0.95 only), MAD x1000
RVM 181 | MODNet 151 | HRNet 119 | PP-MattingV2 117. The PP lead on soft hair is only ~20-25%, versus ~3x on whole-silhouette error. Fractional alpha (hair) is still weak in every engine: this is the biggest remaining quality gap, not solved by switching models.
## Stray-blob cleanup (v0.95, VS.MatteRefine.keepMainSubject, minRel 6%)
Real JS function on real mattes (11-image fair subset): PP-MattingV2 4.34 -> 3.11; HRNet 2.96 -> 2.96, MODNet 13.07 -> 13.02, RVM 8.68 -> 8.71 (no harm). Default ON for stills/exports, OFF for live (localStorage vs_ppm_main = 1 to try live). Known limit: a second person smaller than 6% of the main subject's area is removed.
## Still NOT shown
Video quality, phone speed, BiRefNet/BEN2, any dataset with labelled hair-only categories, Safari/Firefox.
