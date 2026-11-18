const assert = require('assert');
const TM = require('../../js/providers/temporal-matte.js');
const W = 96, H = 64;

// deterministic PRNG
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function scene(shift) {   // a bar (the "person") plus a 1px static hair line far from the bar
  const a = new Uint8Array(W * H);
  for (let y = 10; y < 54; y++) for (let x = 20 + shift; x < 50 + shift; x++) a[y * W + x] = 255;
  for (let y = 5; y < 60; y++) a[y * W + 80] = 255;      // thin 1 px strand
  return a;
}
function noisy(base, amp) {   // jitter only on soft edge-ish pixels: +-amp on every pixel of the bar border and strand
  const a = Uint8Array.from(base);
  for (let i = 0; i < a.length; i++) if (a[i] === 255 || a[i] === 0) { /* hard */ }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, edge = (x === 20 || x === 49 || x === 80 || y === 10 || y === 53);
    if (edge) a[i] = Math.max(0, Math.min(255, 128 + (rnd() * 2 - 1) * amp));
  }
  return a;
}

// 1. static scene, flickering edges: refined flickers clearly less than raw, thin strand is NOT erased
{
  const tm = TM.create(), raws = [], outs = [];
  for (let f = 0; f < 30; f++) { const r = noisy(scene(0), 14); const s = tm.step(r, W, H); raws.push(Uint8Array.from(s.raw)); outs.push(Uint8Array.from(s.refined)); }
  const fr = TM.flicker(raws), fo = TM.flicker(outs.slice(3));
  assert.ok(fo < fr * 0.6, 'refined flicker ' + fo.toFixed(2) + ' should be < 60% of raw ' + fr.toFixed(2));
  const last = outs[outs.length - 1];
  assert.ok(last[30 * W + 80] > 60, 'thin strand must survive (value ' + last[30 * W + 80] + ')');
  assert.strictEqual(last[30 * W + 35], 255, 'solid interior untouched');
  assert.strictEqual(last[30 * W + 5], 0, 'solid background untouched');
}
// 2. raw is never modified
{
  const tm = TM.create(); const a = scene(0), b = scene(2), copy = Uint8Array.from(b);
  tm.step(a, W, H); const s = tm.step(b, W, H);
  assert.deepStrictEqual(Array.from(b), Array.from(copy)); assert.strictEqual(s.raw, b); assert.notStrictEqual(s.refined, b);
}
// 3. fast-moving edge: new position reached within 2 frames, old position cleared within 2 frames (no ghost trail)
{
  const tm = TM.create(); tm.step(scene(0), W, H);
  let s; for (let k = 1; k <= 2; k++) s = tm.step(scene(8), W, H);
  assert.ok(s.refined[30 * W + 56] >= 200, 'new edge region follows (got ' + s.refined[30 * W + 56] + ')');
  assert.ok(s.refined[30 * W + 21] <= 40, 'old region cleared (got ' + s.refined[30 * W + 21] + ')');
}
// 4. per-region: a head turn on the left must not switch smoothing off on the static right half
{
  const tm = TM.create(); const base = () => { const a = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = x < 48 ? 0 : 128; return a; };
  tm.step(base(), W, H);
  const f = base(); for (let y = 0; y < H; y++) for (let x = 0; x < 40; x++) f[y * W + x] = 255;   // big motion left
  for (let y = 0; y < H; y++) for (let x = 70; x < 90; x++) f[y * W + x] = 128 + 12;              // small jitter on the static right
  const s = tm.step(f, W, H);
  assert.ok(s.refined[10 * W + 10] > 200, 'moving block follows');
  assert.ok(s.refined[10 * W + 80] < 128 + 12, 'static block is smoothed (got ' + s.refined[10 * W + 80] + ')');
}
// 5. size change resets state; reset() works
{
  const tm = TM.create(); tm.step(new Uint8Array(W * H).fill(100), W, H);
  const s = tm.step(new Uint8Array(32 * 32).fill(200), 32, 32); assert.strictEqual(s.refined[0], 200); assert.strictEqual(s.stats.frame, 1);
  tm.reset(); assert.strictEqual(tm.step(new Uint8Array(32 * 32).fill(50), 32, 32).refined[0], 50);
}
// 6. convergence: a constant new value is always reached (no stranded off-by-one)
{
  const tm = TM.create(); tm.step(new Uint8Array(64 * 64).fill(100), 64, 64);
  let s; for (let k = 0; k < 40; k++) s = tm.step(new Uint8Array(64 * 64).fill(106), 64, 64);
  assert.strictEqual(s.refined[0], 106);
}
console.log('temporal-matte: all assertions passed');
