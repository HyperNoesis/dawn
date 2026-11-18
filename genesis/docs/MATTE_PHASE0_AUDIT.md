# Matte Engine Mandate: Phase 0 audit and Phase 1-2 status (2026-11-19)

Status words: PASS = tested and evidenced, FAIL, BLOCKED = needs a device/legal decision, NOT TESTED. IMPLEMENTED is not verified.

## What already exists (read from source, deployed v0.97 = repo js/app.js)
| Mandate item | State in code | Evidence | Status |
|---|---|---|---|
| PP-MattingV2 provider (js/providers/ppmatting-provider.js, -core, -worker) | IMPLEMENTED, flagged beta (flags.json ppmattingBeta), selectable in the engine picker | unit tests pass; weights in models/ with SHA-256 in registry.json | NOT TESTED on a phone |
| PP-Matting HRNet for export (ppmatting-export.js) | IMPLEMENTED, benchmark/export only | 1376 ms/frame at 448 px on 1 CPU thread here: export only, not live | PASS as "not live" |
| MediaPipe fallback, MODNet, RVM providers | present | RVM = GPL-3.0, kept opt-in | PASS (licence note) |
| BiRefNet-Lite provider + registry entry | partial; fp16 weights hashed in registry, not bundled | registry says full 1024 inference NOT run | NOT TESTED |
| EdgeTAM kept separate | yes (edgetam-*.js, tracker-gate) | registry | PASS |
| Model manifest / licence inventory | models/registry.json (name, role, licence, commercial flag, files, sha256, tensor shapes for PP models) | MatAnyone2 and SAM2Matting marked non-commercial, not production | PASS (missing: revision/commit field, download URL per file) |
| TemporalMask (whole-frame) and TemporalMatte (per 16x16 block) | IMPLEMENTED; neither warps the previous alpha with optical flow | read temporal-matte.js | Mandate section 5 motion-aware warp: NOT IMPLEMENTED |
| Edge refine (mask-refine.js, matte-refine.js, mask-clean.js) | present; guided-filter edge refine flagged "needs a real GPU test" in NEXT.md | NEXT.md item H | NOT TESTED |
| Foreground colour decontamination (section 7) | not found in providers | grep | NOT IMPLEMENTED |
| WebGPU compositor (section 8) | WebGL compositor (gl-matte.js, render-core.js); no WebGPU path | source | NOT IMPLEMENTED |
| Regression suite | tools/e2e/unit_*.js | 44/44 pass here (node) | PASS |

## Engine selection trace (Phase 0 requirement)
- Before this session: auto started on MediaPipe, then tried RVM, then MODNet in the background; a speed test (budget ~100 ms) and a step-down ladder/governor could swap back to MediaPipe. On the Redmi-class phone this ended on MediaPipe ("legacy").
- v0.98 (this session, js/app.js + patch/js/app.js): quality-first default. MODNet at a 256 px floor starts directly; the ladder never swaps to MediaPipe (only if MODNet cannot load); a slow phone raises mask-refresh stride (2 or 3) instead. vs_quality_first=0 restores the old behaviour. Syntax-checked only. NOT TESTED on a phone.

## Measured here (server CPU, onnxruntime 1 thread, random tensor, NOT a phone and NOT quality)
| Model | Input | p50 ms |
|---|---|---|
| MODNet | 256 | 88 |
| PP-MattingV2 | 320 | 86 |
| PP-MattingV2 | 448 | 173 |
| PP-Matting HRNet | 448 | 1376 |
Reading: PP-MattingV2 at 320 px costs about the same as MODNet at 256 px, so it is a fair candidate for Balanced. Quality on real footage and phone speed are NOT TESTED.

## BLOCKED
- Phone benchmark (needs the user's phone, charged, battery saver off): use ppmatting-lab.html on the deployed site.
- RVM production use (GPL-3.0; commercial licence request drafted, not sent).
- Consented footage with reference alphas for SAD/MAD/dtSSD.

## Next (in order)
1. Phone A/B: MODNet 256 vs PP-MattingV2 320 on identical footage via ppmatting-lab.html.
2. Motion-aware alpha warp (pyramidal LK at low res) with history weight <= 0.25, behind a flag.
3. Decontamination stage (switchable) and WebGPU compositor.

---
# Update 2026-11-19 (session 2): Phases 4 and 5/7 modules

| Mandate item | What was done | Evidence | Status |
|---|---|---|---|
| Section 5 motion-aware temporal stabilisation | NEW js/providers/temporal-flow.js (MotionTemporalMatte): pyramidal block Lucas-Kanade on camera luma, warp previous alpha, per-pixel flow-confidence + alpha-agreement fusion, history capped at 0.25, resets on size change / timestamp gap / scene cut / reset(). Wired into PPMattingV2/HRNet providers as OPT-IN: localStorage vs_ppm_temporal = 'motion'. Default stays 'refined'. | tools/unit/temporal-flow.test.js (7 groups) passes; 11 ms/frame at 320x240 on 1 CPU core (server, not a phone) | PASS (synthetic) / NOT TESTED on real footage and phones |
| Section 7 colour decontamination | NEW js/providers/fg-decontaminate.js (blur fusion, boundary band only, bounded shift, strength 0 = off, alpha never modified). NOT yet connected to the live compositor. | tools/unit/fg-decontaminate.test.js passes; synthetic edge colour error after compositing over a new background 6.74 -> 4.79 (strength 0.8) / 4.27 (1.0); 12 ms/frame at 320x240 on 1 CPU core | PASS (synthetic) / NOT WIRED / NOT TESTED on real footage |
| Regression | unit 14/14 files, e2e unit 44/44 | node tools/unit/run-all.js; tools/e2e/unit_*.js | PASS |

## Honest findings (do not over-read the synthetic numbers)
- On a synthetic moving bar with noisy edges, MotionTemporalMatte is NOT measurably better than the existing TemporalMatte: while moving, edge noise is larger than the agreement window so both pass the model output through (instability 9.72 vs 9.71 vs raw 9.71 at 4 px/frame), and when static it smooths less (0.257 vs 0.216, raw 0.311) because the mandate caps history at 0.25 while TemporalMatte follows at 0.35 with up to 0.65 history. Its value (aligning history to moving edges) can only be judged on real labelled footage. Keep it opt-in until a phone/real-footage A/B (ppmatting-lab.html) shows an advantage.
- A bug found by the tests and fixed: a first frame without luma left no luma history, and the next frame crashed. It now resets cleanly.
- The decontamination gain is measured on a perfectly known synthetic edge (known F and B). Real hair over a real background will be worse; the claim is limited to "reduces fringe on this synthetic case, bounded and switchable".

## Still BLOCKED / NOT DONE
- WebGPU compositor (section 8): NOT IMPLEMENTED; cannot be exercised in this sandbox (no GPU). WebGL path unchanged.
- Edge-aware full-resolution guided upsampling (section 6): existing matte-refine.js/mask-refine.js untouched; needs a real GPU test (NEXT.md item H).
- Wiring decontamination into gl-matte.js / render-core.js and A/B toggle in the UI.
- Phone benchmarks, consented footage and reference alphas (SAD/MAD/dtSSD), 10-20 min sustained session, thermal: BLOCKED (physical device).
- Model manifest gaps from the first audit: revision/commit and download URL per file in models/registry.json.
- Auto/Balanced promotion of PP-MattingV2: only after the phone A/B (promotePPMatting stays 0).
- BiRefNet-Lite aspect handling and weights, BEN2: NOT TESTED (weights not bundled).
