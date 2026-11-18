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
