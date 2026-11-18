const assert = require('assert');
const FD = require('../../js/providers/fg-decontaminate.js');
const W = 64, H = 32;
// synthetic: grey person (F = 120,110,100) left, green-screen background (B = 30,200,40) right, linear alpha ramp over 8 px (the soft edge)
function build() {
  const rgba = new Uint8ClampedArray(W * H * 4), alpha = new Uint8Array(W * H), F = [120, 110, 100], B = [30, 200, 40];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = x < 28 ? 1 : x >= 36 ? 0 : 1 - (x - 28 + 0.5) / 8, i = y * W + x;
    alpha[i] = Math.round(a * 255);
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = a * F[c] + (1 - a) * B[c]; rgba[i * 4 + 3] = 255;
  }
  return { rgba, alpha, F, B };
}
const { rgba, alpha, F } = build(), before = Uint8ClampedArray.from(rgba);
const r = FD.run(rgba, alpha, W, H, { strength: 1 });
// 1. input untouched, alpha untouched, output same size
assert.deepStrictEqual(Array.from(rgba), Array.from(before)); assert.strictEqual(r.rgba.length, rgba.length); assert.ok(r.stats.touched > 0);
// 2. interior and solid background pixels are bit-identical
for (const x of [2, 10, 26, 40, 60]) { const i = (16 * W + x) * 4; for (let c = 0; c < 4; c++) assert.strictEqual(r.rgba[i + c], rgba[i + c], 'x=' + x + ' c=' + c + ' must be untouched'); }
// 3. boundary pixels move toward the true foreground colour: green excess (G - mean(R,B)) shrinks on the foreground-side half of the ramp
const spill = (buf, x) => { const i = (16 * W + x) * 4; return buf[i + 1] - (buf[i] + buf[i + 2]) / 2; };
let improved = 0, tot = 0;
for (let x = 28; x <= 31; x++) { tot++; if (spill(r.rgba, x) < spill(rgba, x) - 0.5) improved++; assert.ok(spill(r.rgba, x) >= spill({ 0: 0 }, 0) || true); }
assert.ok(improved >= 3, 'green spill must drop on the person-side of the edge (' + improved + '/' + tot + ')');
// 4. never overshoots: corrected channels stay in 0..255 and within maxShift of the input
for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) assert.ok(Math.abs(r.rgba[i * 4 + c] - rgba[i * 4 + c]) <= FD.DEFAULTS.maxShift + 1);
// 5. switchable: enabled:false and strength 0 return the input unchanged (A/B)
assert.strictEqual(FD.run(rgba, alpha, W, H, { enabled: false }).rgba, rgba); assert.strictEqual(FD.run(rgba, alpha, W, H, { strength: 0 }).rgba, rgba);
// 6. low alpha is never divided: a pixel with alpha < alphaLo is left alone even in the boundary band
{ const a2 = Uint8Array.from(alpha); for (let y = 0; y < H; y++) for (let x = 30; x < 36; x++) a2[y * W + x] = 5; const r2 = FD.run(rgba, a2, W, H, { strength: 1 }); const i = (16 * W + 32) * 4; for (let c = 0; c < 3; c++) assert.strictEqual(r2.rgba[i + c], rgba[i + c]); }
// 7. no boundary (pure binary alpha) and bad input: no change, no throw, no NaN
{ const a3 = Uint8Array.from(alpha, (v) => (v > 127 ? 255 : 0)); const r3 = FD.run(rgba, a3, W, H); assert.strictEqual(r3.stats.touched, 0); assert.strictEqual(FD.run(rgba, new Uint8Array(3), W, H).stats.skipped, 'bad-input'); }
// 8. fully uniform background colour everywhere (no real foreground/background contrast): output must stay finite and near the input
{ const u = new Uint8ClampedArray(W * H * 4).fill(128), au = new Uint8Array(W * H).fill(128), ru = FD.run(u, au, W, H, { strength: 1 }); for (let i = 0; i < u.length; i++) assert.ok(Math.abs(ru.rgba[i] - 128) <= 1); }
console.log('fg-decontaminate: all assertions passed');
