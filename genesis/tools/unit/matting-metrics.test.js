const assert = require('assert');
const M = require('../../js/providers/matting-metrics.js');
const near = (a, b, e, m) => assert.ok(Math.abs(a - b) <= (e || 1e-9), (m || '') + ' got ' + a + ' want ' + b);

// SAD / MAD / MSE with hand-computed values: 4 px, errors 1, 0, 0.5, 0
const gt = Uint8Array.from([255, 0, 0, 255]), pr = Uint8Array.from([0, 0, 128, 255]);
let e = M.errors(pr, gt); near(e.sad, (1 + 0 + 128 / 255 + 0) / 1000, 1e-9); near(e.mad, ((1 + 128 / 255) / 4) * 1000, 1e-6); near(e.mse, ((1 + (128 / 255) ** 2) / 4) * 1000, 1e-6);
// identical -> zero
e = M.errors(gt, gt); assert.deepStrictEqual([e.sad, e.mad, e.mse], [0, 0, 0]);
// trimap restricts to unknown (128) pixels
e = M.errors(pr, gt, Uint8Array.from([0, 0, 128, 255])); assert.strictEqual(e.pixels, 1); near(e.mad, (128 / 255) * 1000, 1e-6);
assert.throws(() => M.errors(new Uint8Array(3), new Uint8Array(4)));
// gradient error: blurred edge vs sharp edge > 0; same -> 0; more blur -> larger
const W = 32, H = 32, sharp = new Uint8Array(W * H), soft = new Uint8Array(W * H), soft2 = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { sharp[y * W + x] = x >= 16 ? 255 : 0; soft[y * W + x] = Math.max(0, Math.min(255, (x - 12) * 32)); soft2[y * W + x] = Math.max(0, Math.min(255, (x - 4) * 9)); }
assert.strictEqual(M.gradientError(sharp, sharp, W, H), 0);
const g1 = M.gradientError(soft, sharp, W, H), g2 = M.gradientError(soft2, sharp, W, H); assert.ok(g1 > 0 && g2 > g1, 'more blur -> larger error ' + g1 + ' ' + g2);
// dtSSD: a prediction that moves exactly like the ground truth scores 0; a flickering one does not
const mk = (v) => new Uint8Array(16).fill(v);
near(M.dtSSD([mk(0), mk(100), mk(200)], [mk(10), mk(110), mk(210)]), 0, 1e-9);
assert.ok(M.dtSSD([mk(0), mk(100), mk(0)], [mk(0), mk(0), mk(0)]) > 30);
// flicker: ignores pixels where the source picture itself moved
const a0 = Uint8Array.from([0, 0]), a1 = Uint8Array.from([100, 100]), l0 = Uint8Array.from([50, 50]), l1 = Uint8Array.from([50, 200]);
near(M.flicker([a0, a1], [l0, l1], 6), (100 / 255) * 100, 1e-9);    // only pixel 0 counts (pixel 1 moved in the source)
assert.strictEqual(M.flicker([a0], null), 0);
// latency
const L = M.latency([10, 20, 30, 40, 100]); near(L.p50, 30); assert.ok(L.p95 > 40 && L.p95 <= 100); near(L.mean, 40); near(L.fps, 25); assert.strictEqual(M.latency([]).n, 0);
console.log('matting-metrics: all assertions passed');
