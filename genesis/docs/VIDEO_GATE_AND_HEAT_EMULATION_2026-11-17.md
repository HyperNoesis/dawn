# Video gate + heat emulation (2026-11-17)

## Video gate (offline, synthetic moving clips with exact alpha, 8 clips x 45 frames, 640x360, sandbox CPU 2 threads)
Mean over clips (MAD x1000 / edge-band x1000 / dtssd / ms per frame):
- MODNet@384  10.57 / 46.7 / 5.52 / 56   (lowlight clip broke: MAD 48.8)
- MODNet@512   5.51 / 38.6 / 4.70 / 118
- RVM@384 (recurrent state)  5.33 / 40.6 / 4.76 / 50
- PP-V2@384    5.58 / 41.9 / 5.06 / 33
- PP-V2@512    4.75 / 35.7 / 4.62 / 65
PP-V2 is ~1.7x faster than MODNet at equal size and wins low light; it LOSES on the two fast-motion clips (MODNet@512 8.0-8.4 vs PP-V2@512 9.6-10.9).
Decision: promotePPMatting stays 0 until real fast-motion footage is checked. Raw: docs/video_gate_2026-11-17.json. Tools: tools/matting-bench/{gen_clips.py,video_gate.py}.

## Live heat/weak-device emulation (tools/e2e/t49_heat_emulation.js)
Real Chromium, real weights, fake camera fed with the clips, renderer pinned to the loaded cores, 0->3 busy loops (camera process kept free).
Defects the emulation found in the governor (all fixed, unit tests 17-19 added):
1. At the smallest size a ~350 ms mask (< HOPELESS_MS 700) = permanent 3-5 fps slideshow, never escalated. Fix: SLIDESHOW_FPS/SLIDESHOW_SEC rule -> light model after 15 s model-bound < 8 fps at the floor.
2. After going to the light model, if the frame was slow for another reason the governor stayed light forever. Fix: NOGAIN rule -> if light gives < 1.3x fps after 20 s, return to matting and do not go light again for 10 min.
3. (harness) the 60-entry segLog ring dropped events when indexed by position; the harness now hooks push.
Live result: 224 px step at ~20 s, light model at ~179 s (only under 3 hogs), back to MODNet 224 at ~207 s because the light model gave no gain; no flapping; no uncaught page errors.

## What this does NOT prove
Sandbox CPU is below any phone (MODNet@320 = ~440 ms); no live upward-recovery was possible here (no headroom even unloaded) - recovery is covered by simulation tests 5/6/17-19 only. No real thermals, no GPU/WebGL phone path, no real camera ISP, no Safari/Firefox/iOS.
