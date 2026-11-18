const assert = require('assert');
const P = require('../../js/providers/birefnet-provider.js'); const { resampleAlpha, looksLikeLogits } = P.core;
// logits detection
assert.strictEqual(looksLikeLogits(new Float32Array([0.1, 0.9, 0.5])), false); assert.strictEqual(looksLikeLogits(new Float32Array([-4, 6, 0])), true);
// 4x4 logits (left half strongly fg, right half strongly bg) -> 8x8 alpha, values in range, monotonic across the edge
const src = new Float32Array(16); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) src[y * 4 + x] = x < 2 ? 8 : -8;
const a = resampleAlpha(src, 4, 8, 8, true, new Uint8Array(64));
assert.ok(a[0] > 250 && a[7] < 5, 'ends saturate'); for (let x = 1; x < 8; x++) assert.ok(a[x] <= a[x - 1], 'non-increasing across edge');
assert.ok(a[3] > 0 && a[3] < 255 || a[4] > 0 && a[4] < 255, 'soft transition at the edge');
// already-probabilities path
const b = resampleAlpha(new Float32Array(16).fill(0.5), 4, 4, 4, false, new Uint8Array(16)); assert.ok(b.every((v) => v === 128 || v === 127));
// v0.94 letterbox: 16:9 frame in the 1024 square -> 1024 x 576 band centred; stretch fills all; portrait is centred horizontally
const { fitRect, resampleAlphaRect } = P.core;
assert.deepStrictEqual(fitRect(1280, 720, 1024), { dx: 0, dy: 224, dw: 1024, dh: 576 });
assert.deepStrictEqual(fitRect(720, 1280, 1024), { dx: 224, dy: 0, dw: 576, dh: 1024 });
assert.deepStrictEqual(fitRect(640, 640, 1024), { dx: 0, dy: 0, dw: 1024, dh: 1024 });
assert.deepStrictEqual(fitRect(1280, 720, 1024, 'stretch'), { dx: 0, dy: 0, dw: 1024, dh: 1024 });
// a probability plane that is fg only inside the band's left half: the rect resampler must see ONLY the band (padding rows are ignored)
{ const N = 16, r = fitRect(32, 16, N), d = new Float32Array(N * N).fill(0.0); // r = 16 x 8 band at dy=4
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) d[y * N + x] = (y < r.dy || y >= r.dy + r.dh) ? 1 : (x < 8 ? 1 : 0); // padding rows say "fg" (must be ignored)
  const o = resampleAlphaRect(d, N, r, 32, 16, false, new Uint8Array(32 * 16));
  assert.ok(o[0] === 255 && o[31] === 0 && o[15 * 32] === 255 && o[15 * 32 + 31] === 0, 'band only, padding ignored'); }
console.log('birefnet-core: all assertions passed');
