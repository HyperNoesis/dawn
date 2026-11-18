// VideoGuard: scene cuts, occlusion, subject loss + hold/fade, recovery (synthetic sequences; no model needed).
const G = require('../../js/providers/video-guard.js'); const assert = require('assert');
const W = 64, H = 36;
const blob = (x0, y0, x1, y1) => { const a = new Uint8Array(W * H); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * W + x] = 255; return a; };
const luma = (v) => new Uint8Array(32 * 18).fill(v);
const subj = () => blob(20, 4, 44, 36), empty = () => new Uint8Array(W * H), half = () => blob(20, 20, 44, 36);
const run = (g, a, l) => g.step({ alpha: a, w: W, h: H, luma: l == null ? null : luma(l) });

// 1. steady subject: always tracking, never resets, held() is the last frame
{ const g = G.create(); let d; for (let i = 0; i < 30; i++) d = run(g, subj(), 100); assert.equal(d.state, 'tracking'); assert(!d.resetTemporal && !d.useHeld && !d.sceneCut); assert.deepEqual(Array.from(g.held()), Array.from(subj())); }

// 2. lighting change with the same subject is NOT a scene cut
{ const g = G.create(); for (let i = 0; i < 5; i++) run(g, subj(), 100); const d = run(g, subj(), 160); assert(!d.sceneCut && !d.resetTemporal, 'lighting change must not reset'); }

// 3. real cut: picture changes a lot AND the subject jumps -> reset temporal, no hold
{ const g = G.create(); for (let i = 0; i < 5; i++) run(g, subj(), 100); const d = run(g, blob(0, 10, 14, 36), 30); assert(d.sceneCut && d.resetTemporal && !d.useHeld && d.state === 'tracking', JSON.stringify(d)); }

// 4. partial occlusion (hand over lens covers part): keep tracking the model output, never hold
{ const g = G.create(); for (let i = 0; i < 10; i++) run(g, subj(), 100); let d; for (let i = 0; i < 6; i++) d = run(g, half(), 100); assert.equal(d.state, 'occluded'); assert(!d.useHeld); }

// 5. subject lost: hold the last good matte, fade to zero, never stay stuck
{ const g = G.create(); for (let i = 0; i < 10; i++) run(g, subj(), 100); const fades = []; let d, held = 0;
  for (let i = 0; i < 20; i++) { d = run(g, empty(), 100); if (d.useHeld) { held++; fades.push(d.fade); } }
  assert.equal(d.state, 'lost'); assert(held >= 10, 'held for a while'); assert(fades.every((f, i) => i === 0 || f <= fades[i - 1]), 'fade is monotonic'); assert.equal(fades[fades.length - 1], 0, 'fully cleared: no stuck mask');
  assert.deepEqual(Array.from(g.held()), Array.from(subj()), 'held matte is the last GOOD one, not the empty one'); }

// 6. recovery: subject returns -> exactly one temporal reset, then tracking
{ const g = G.create(); for (let i = 0; i < 10; i++) run(g, subj(), 100); for (let i = 0; i < 8; i++) run(g, empty(), 100); const d1 = run(g, subj(), 100); assert(d1.resetTemporal && d1.state === 'tracking' && !d1.useHeld, JSON.stringify(d1)); const d2 = run(g, subj(), 100); assert(!d2.resetTemporal); }

// 7. a one-frame dropout is not "lost" (needs lostFrames in a row)
{ const g = G.create(); for (let i = 0; i < 10; i++) run(g, subj(), 100); const d = run(g, empty(), 100); assert(!d.useHeld && d.state === 'occluded'); const e = run(g, subj(), 100); assert.equal(e.state, 'tracking'); }

// 8. no luma thumbnail given: still works (no scene-cut detection, loss/recovery unaffected)
{ const g = G.create(); for (let i = 0; i < 6; i++) g.step({ alpha: subj(), w: W, h: H }); for (let i = 0; i < 5; i++) g.step({ alpha: empty(), w: W, h: H }); assert.equal(g.state(), 'lost'); }

// 9. reset() clears everything
{ const g = G.create(); for (let i = 0; i < 6; i++) run(g, subj(), 100); g.reset(); assert.equal(g.held(), null); assert.equal(g.state(), 'tracking'); }
console.log('video-guard: all assertions passed');
