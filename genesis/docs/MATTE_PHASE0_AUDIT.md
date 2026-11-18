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
# Update 2026-11-19 (session 2): phase status against the mandate (supersedes the table above where they differ)

## Corrections to the first audit
- Section 7 (decontamination) was marked NOT IMPLEMENTED. Wrong: `MatteRefine.estimateForeground` exists (export, opt-in) and the live WebGL compositor already does guided upsample plus despill (gl-matte.js). A second module written this session (fg-decontaminate.js) was measured against `estimateForeground` on the same synthetic soft edge (colour error after compositing over a new background: none 6.74, new module 4.27, existing 0.09), was clearly worse, and was DELETED. Do not re-add it.
- Section 6 guided upsampling exists in gl-matte.js (live). Its real-GPU quality is still NOT TESTED (NEXT.md item H).
- Section 3/14 routing and release gates exist (engine-policy.js: liveOrder, placement, evaluateGate, canPromote). Default stays Auto/MODNet; promotePPMatting = 0.
- BiRefNet-Lite aspect handling is already fixed (letterbox, v0.94) with tests; weights are NOT bundled.

## Phase table
| Phase | Result | Evidence | Status |
|---|---|---|---|
| 0 Baseline audit | done (above) | unit 14 files (incl. new), e2e unit 44/44 | PASS |
| 1 Benchmark harness | exists: tools/matting-bench (bench.py MAD/SAD/gradient/dtSSD/flicker/latency, score_gt.py, video_gate.py), ppmatting-lab.html | bench.py --selftest passes | PASS (harness); real-footage runs BLOCKED |
| 2 PP-MattingV2 | provider, registry, SHA-256 verified; registry now carries upstream commit b812d276f789 (repo HEAD checked 2026-11-19), release tag `weights`, release page | `node tools/model-manifest.js`: 9 bundled files PASS (size + SHA-256) | PASS (integrity); numeric match to upstream was recorded in v0.94 (6e-8); phone speed NOT TESTED |
| 3 Routing | exists (engine-policy.js); unchanged | engine-policy tests | PASS (logic); on-device warm-up measurement NOT TESTED |
| 4 Temporal | NEW temporal-flow.js (pyramidal block LK, warp previous alpha, flow-confidence + agreement fusion, history <= 0.25, resets on size/gap/cut), opt-in via vs_ppm_temporal='motion' | temporal-flow.test.js, 11 ms/frame 320x240 on 1 server core | PASS (synthetic); real footage NOT TESTED. On the synthetic set it is NOT measurably better than TemporalMatte (see below) |
| 5 Edge refinement | existing gl-matte.js guided upsample, matte-refine.js, mask-clean.js; nothing new added | existing tests | NOT TESTED on a GPU |
| 6 GPU compositor | NEW gpu-composite.js (WebGPU, linear-light, texture reuse, device-lost handling, returns null so WebGL stays) opt-in vs_webgpu_composite='1'; NOT wired into render-core | CPU reference test passes; shader never run (no GPU here) | IMPLEMENTED, NOT TESTED |
| 7 Export | exists (ppmatting-export.js, HRNet 1376 ms/frame at 448 px on 1 CPU thread: export only) | audit above | PASS "not live"; decode-and-inspect of a real export NOT TESTED |
| 8 Release certification | model manifest + checksum report generated (docs/MODEL_MANIFEST.md); licences: RVM GPL-3.0 stays off | model-manifest.js | PARTIAL: device matrix, 10-20 min sustained run, physical-device evidence BLOCKED |

## Honest findings
- MotionTemporalMatte vs TemporalMatte on the synthetic moving bar with noisy edges: error against truth equal to within 0.04 MAE; instability while moving 9.72 vs 9.71 (raw 9.71); static 0.257 vs 0.216 (raw 0.311) because the mandate caps history at 0.25. No demonstrated gain. Keep opt-in; decide on real labelled footage via ppmatting-lab.html.
- A bug found by the tests and fixed: first frame without luma crashed the next frame.

## BLOCKED (needs you, a phone, or a decision)
- Phone A/B (MODNet 256 vs PP-MattingV2 320, and motion vs refined temporal) on identical consented footage with reference alphas.
- WebGPU shader and WebGPU ONNX runtime checks on a real adapter; wiring gpu-composite into render-core only after that.
- BiRefNet-Lite / BEN2 weights (not bundled; the 4 GB sandbox ran out of memory on 1024 inference), MatAnyone/SAM2Matting stay research-only.
- RVM commercial licence decision (GPL-3.0).
