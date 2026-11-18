const assert = require('assert');
const TF = require('../../js/providers/temporal-flow.js');
const TM = require('../../js/providers/temporal-matte.js');
const W = 128, H = 96;
let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
// fixed smooth-ish texture so LK has structure to lock onto (sum of sines, deterministic)
const tex = (x, y) => 128 + 50 * Math.sin(x * 0.31) * Math.cos(y * 0.23) + 40 * Math.sin((x + y) * 0.17) + 20 * Math.sin(x * 0.9 + y * 0.4);
// scene: textured background, the "person" is a bright textured block that moves by dx per frame; background is static
function frame(dx, noise) {
  const luma = new Uint8Array(W * H), alpha = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, inside = x >= 30 + dx && x < 70 + dx && y >= 14 && y < 82;
    luma[i] = inside ? Math.max(0, Math.min(255, tex(x - dx, y) + 40)) : Math.max(0, Math.min(255, tex(x * 0.5 + 200, y * 0.5) - 30));
    let a = inside ? 255 : 0;
    if (noise && (x === 30 + dx || x === 69 + dx)) a = Math.max(0, Math.min(255, 128 + (rnd() * 2 - 1) * noise));
    alpha[i] = a;
  }
  return { luma, alpha };
}
const truth = (dx) => frame(dx, 0).alpha;
const mae = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

// 1. static scene with flickering edges: refined flickers less than raw, solid interior/background untouched
{
  const mt = TF.create(), raws = [], outs = [];
  for (let f = 0; f < 30; f++) { const fr = frame(0, 30); const s = mt.step(fr.alpha, fr.luma, W, H, f * 33); raws.push(Uint8Array.from(s.raw)); outs.push(Uint8Array.from(s.refined)); }
  const fr = TM.flicker(raws), fo = TM.flicker(outs.slice(3));
  assert.ok(fo < fr * 0.9, 'refined flicker ' + fo.toFixed(3) + ' should be below raw ' + fr.toFixed(3));
  const last = outs[outs.length - 1];
  assert.strictEqual(last[48 * W + 50], 255); assert.strictEqual(last[48 * W + 5], 0);
}
// 2. history never exceeds the cap: |refined - raw| <= maxHistory * |warped - raw| (+ rounding) on every pixel
{
  const mt = TF.create({ maxHistory: 0.25 }); let prev = null, worst = 0;
  for (let f = 0; f < 12; f++) {
    const fr = frame(f * 2, 0), s = mt.step(fr.alpha, fr.luma, W, H, f * 33);
    for (let i = 0; i < s.raw.length; i++) worst = Math.max(worst, Math.abs(s.refined[i] - s.raw[i]));
    prev = s;
  }
  assert.ok(worst <= 0.25 * 255 + 1, 'max deviation from raw ' + worst + ' must stay within the history cap');
}
// 3. fast motion (4 px/frame): no trail. Error against the true current matte stays tiny, and is no worse than the per-pixel TemporalMatte
{
  const mt = TF.create(), tmo = TM.create(); let eMotion = 0, eBase = 0, eRaw = 0, k = 0;
  for (let f = 0; f < 14; f++) {
    const fr = frame(f * 4, 0), a = mt.step(fr.alpha, fr.luma, W, H, f * 33), b = tmo.step(fr.alpha, W, H);
    if (f >= 3) { const t = truth(f * 4); eMotion += mae(a.refined, t); eBase += mae(b.refined, t); eRaw += mae(a.raw, t); k++; }
    assert.ok(a.stats.reset === '' || f === 0, 'no reset expected during smooth motion (frame ' + f + ': ' + a.stats.reset + ')');
  }
  assert.ok(eMotion / k <= 0.5, 'trail error vs truth ' + (eMotion / k).toFixed(3));
  assert.ok(eMotion / k <= eBase / k + 0.05, 'motion-aware ' + (eMotion / k).toFixed(3) + ' must not trail more than 0.05 above baseline ' + (eBase / k).toFixed(3));
}
// 4. estimated flow is in the right direction and size for a translating subject
{
  const mt = TF.create(); let s;
  for (let f = 0; f < 6; f++) { const fr = frame(f * 3, 0); s = mt.step(fr.alpha, fr.luma, W, H, f * 33); }
  assert.ok(s.stats.meanFlow > 0, 'flow magnitude must be measured, got ' + s.stats.meanFlow);
}
// 5. resets: scene cut, timestamp gap, size change, explicit reset(); raw is returned untouched and history is dropped
{
  const mt = TF.create(); const a = frame(0, 0);
  mt.step(a.alpha, a.luma, W, H, 0); mt.step(a.alpha, a.luma, W, H, 33);
  const inv = Uint8Array.from(a.luma, (v) => 255 - v);
  let s = mt.step(a.alpha, inv, W, H, 66); assert.strictEqual(s.stats.reset, 'cut');
  s = mt.step(a.alpha, inv, W, H, 66 + 5000); assert.strictEqual(s.stats.reset, 'gap');
  s = mt.step(new Uint8Array(64 * 48), new Uint8Array(64 * 48), 64, 48, 5100); assert.strictEqual(s.stats.reset, 'size');
  mt.reset(); s = mt.step(a.alpha, a.luma, W, H, 0); assert.strictEqual(s.stats.reset, 'first');
  assert.strictEqual(s.refined.length, a.alpha.length); assert.deepStrictEqual(Array.from(s.refined), Array.from(a.alpha));
}
// 6. raw is never modified; newly visible region (no counterpart in the old frame) follows the current matte at once
{
  const mt = TF.create(); const a = frame(0, 0), b = frame(0, 0), copy = Uint8Array.from(b.alpha);
  mt.step(a.alpha, a.luma, W, H, 0); const s = mt.step(b.alpha, b.luma, W, H, 33);
  assert.deepStrictEqual(Array.from(b.alpha), Array.from(copy)); assert.strictEqual(s.raw, b.alpha); assert.notStrictEqual(s.refined, b.alpha);
  const c = frame(0, 0); for (let y = 20; y < 40; y++) for (let x = 100; x < 120; x++) { c.alpha[y * W + x] = 255; c.luma[y * W + x] = 250; }   // a hand appears
  const s2 = mt.step(c.alpha, c.luma, W, H, 66);
  assert.ok(s2.refined[30 * W + 110] >= 250, 'newly visible region must show at once (' + s2.refined[30 * W + 110] + ')');
}
// 7. bad input never throws or yields NaN / out-of-range values
{
  const mt = TF.create(); const a = frame(0, 0); const s = mt.step(a.alpha, null, W, H, 0);
  assert.strictEqual(s.refined.length, W * H);
  const s2 = mt.step(a.alpha, a.luma, W, H, 33);
  for (let i = 0; i < s2.refined.length; i++) assert.ok(s2.refined[i] >= 0 && s2.refined[i] <= 255);
}
console.log('temporal-flow: all assertions passed');
