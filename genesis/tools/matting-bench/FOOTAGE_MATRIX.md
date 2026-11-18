# Footage matrix checklist (v0.94)

Source: Genesis Segmentation Model Research Decision, 16 Nov 2026, section "Test footage matrix" and "Suggested release gates".
Purpose: fill the two gates the code cannot judge alone: `hairFingersRealFootage` and `realDevice`.

## Rules for a fair test
- Same clips, same output resolution, same post-processing, same device for every engine (PP-MattingV2, MODNet, RVM, MediaPipe, and BiRefNet for stills).
- Use only footage you own or have written consent to use. Keep it out of the repo (`*.mp4` is git-ignored).
- Whole-pipeline timing (capture -> matte -> composite), not just neural inference. The lab page records this.
- A clip with labelled alpha is worth more than ten without. Label at least 5 key frames per clip (any matting tool; export 8-bit PNG alpha) and name them `<clip>_f<frameNo>.png`.

## Clip list (tick when recorded and run)
Record 10-20 s per clip at the phone's normal camera resolution.

| # | Scenario | Clip to record | Recorded | Alpha labelled | MODNet | PP-MattingV2 | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Fine / textured hair | Curly or coily hair, front-lit, plain background | [ ] | [ ] | [ ] | [ ] | |
| 2 | Fine / textured hair | Loose strands / flyaways, backlit by window | [ ] | [ ] | [ ] | [ ] | |
| 3 | Fine / textured hair | Tied-up or braided hair, dark background | [ ] | [ ] | [ ] | [ ] | |
| 4 | Fine / textured hair | Straight hair, bright background | [ ] | [ ] | [ ] | [ ] | |
| 5 | Motion | Head turns left/right, 3 times | [ ] | [ ] | [ ] | [ ] | |
| 6 | Motion | Walk toward and away from camera | [ ] | [ ] | [ ] | [ ] | |
| 7 | Motion | Fast hand gestures, waving | [ ] | [ ] | [ ] | [ ] | |
| 8 | Motion | Partial occlusion: walk in and out of frame | [ ] | [ ] | [ ] | [ ] | |
| 9 | Difficult edges | Hands near face, fingers spread | [ ] | [ ] | [ ] | [ ] | |
| 10 | Difficult edges | Glasses (clear and tinted) | [ ] | [ ] | [ ] | [ ] | |
| 11 | Difficult edges | Headphones / headwrap / earrings | [ ] | [ ] | [ ] | [ ] | |
| 12 | Difficult edges | Lace or fine fabric, loose cloth | [ ] | [ ] | [ ] | [ ] | |
| 13 | Difficult edges | Motion blur while moving a hand quickly | [ ] | [ ] | [ ] | [ ] | |
| 14 | Lighting / background | Low light (one lamp) | [ ] | [ ] | [ ] | [ ] | |
| 15 | Lighting / background | Window backlight | [ ] | [ ] | [ ] | [ ] | |
| 16 | Lighting / background | Clothing similar in colour to the background | [ ] | [ ] | [ ] | [ ] | |
| 17 | Lighting / background | Busy room (people, posters, clutter) | [ ] | [ ] | [ ] | [ ] | |

## Device runs
Fill in per device. Use `ppmatting-lab.html` -> Live camera.

| Device | Tier (engine-policy) | Engine | Session min | fps | p50 ms | p95 ms | Mem growth MB | Black frames | Recovery failures | Thermal note |
|---|---|---|---|---|---|---|---|---|---|---|
| Genesis target phone (Redmi 14C) | | PP-MattingV2 | 10-20 | | | | | | | |
| Genesis target phone (Redmi 14C) | | MODNet | 10-20 | | | | | | | |
| Midrange Android | | PP-MattingV2 | 10-20 | | | | | | | |
| Desktop integrated GPU | | PP-MattingV2 | 10 | | | | | | | |
| Desktop discrete GPU | | PP-MattingV2 | 10 | | | | | | | |

Recovery tests per device (each must give no silent black frame or stuck mask):
- [ ] Rotate the phone portrait -> landscape -> portrait
- [ ] Switch front/back camera
- [ ] Background the browser tab for 30 s, return
- [ ] Deny then re-grant camera permission
- [ ] Start/stop camera 5 times in a row

## Judging (do this side by side, same clip, engines A/B)
Score each clip: better / same / worse for PP-MattingV2 vs MODNet on (a) hair edge, (b) fingers/glasses, (c) flicker/shimmer, (d) lag/trails.

- If PP-MattingV2 wins stills (a, b) but loses motion (c, d): keep it for still/export only. Do not force it into live preview (PDF stop condition).
- `hairFingersRealFootage` = true only if PP-MattingV2 is at least as good as MODNet on clips 1-4 and 9-13 under the agreed set.
- `realDevice` = true only after the target-phone run above meets the targets in `engine-policy.js` (`DEFAULT_TARGETS`).

## Ground-truth metrics (offline)
Run `python3 tools/matting-bench/bench.py --help`. It computes MAD, SAD, gradient error, dtSSD and latency on labelled frames, using the same formulas as `js/providers/matting-metrics.js`.
