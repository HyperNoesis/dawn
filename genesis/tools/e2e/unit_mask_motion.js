// Confidence-gated mask propagation: synthetic motion tests. Run: node tools/e2e/unit_mask_motion.js
const assert = require('assert');
global.window = global; global.VS = {};
const M = require('../../js/providers/mask-motion.js');

const W = 64, H = 36, BLOCK = 8;
assert.deepStrictEqual(M.analysisSize(640, 480, 64), { width: 64, height: 48 }, '4:3 source keeps its aspect ratio');
assert.deepStrictEqual(M.analysisSize(1280, 720, 64), { width: 64, height: 36 }, '16:9 source keeps its aspect ratio');
assert.deepStrictEqual(M.analysisSize(1080, 1920, 64), { width: 64, height: 114 }, 'portrait source keeps its aspect ratio');
function pattern(seed) {
  let x = seed >>> 0; const a = new Uint8Array(W * H);
  for (let i = 0; i < a.length; i++) { x = (1664525 * x + 1013904223) >>> 0; a[i] = 35 + (x % 190); }
  return a;
}
function translate(src, dx, dy) {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.max(0, Math.min(W - 1, x - dx));
    const sy = Math.max(0, Math.min(H - 1, y - dy));
    out[y * W + x] = src[sy * W + sx];
  }
  return out;
}
{
  const src = pattern(7), cur = translate(src, 2, 0);
  const flow = M.estimateFlow(src, cur, W, H, { blockSize: BLOCK, searchRadius: 3 });
  assert.ok(flow.coverage > 0.35, 'textured scene has usable motion coverage: ' + flow.coverage);
  assert.ok(flow.meanConfidence > 0.15, 'textured scene has usable confidence: ' + flow.meanConfidence);
  assert.ok(Math.abs(flow.meanDx + 2) < 0.6, 'backward flow points to previous x-2: ' + flow.meanDx);
  assert.ok(Math.abs(flow.meanDy) < 0.4, 'horizontal translation has near-zero y motion: ' + flow.meanDy);
  const alpha = new Uint8Array(W * H);
  for (let y = 8; y < 28; y++) for (let x = 24; x < 32; x++) alpha[y * W + x] = 255;
  const warped = M.warpAlpha(alpha, W, H, flow, W, H);
  assert.ok(warped[18 * W + 31] > 200, 'matte follows two-pixel rightward subject motion at its new edge');
  assert.strictEqual(warped[18 * W + 24], 0, 'the vacated leading edge in the same flow block is no longer filled');
}
{
  const src = pattern(19), flow = M.estimateFlow(src, src, W, H, { blockSize: BLOCK, searchRadius: 3 });
  assert.ok(flow.coverage > 0.35, 'static textured scene has reliable blocks');
  assert.ok(Math.abs(flow.meanDx) < 0.1 && Math.abs(flow.meanDy) < 0.1, 'static scene does not drift');
}
{
  const src = new Uint8Array(W * H).fill(100), cur = new Uint8Array(W * H).fill(100);
  const flow = M.estimateFlow(src, cur, W, H, { blockSize: BLOCK, searchRadius: 3 });
  assert.strictEqual(flow.coverage, 0, 'flat low-texture scene refuses to invent motion');
  assert.strictEqual(flow.meanConfidence, 0, 'flat scene has no false confidence');
}
{
  const a = new Uint8Array([1, 2, 3]), b = new Uint8Array([2, 4, 6]);
  assert.strictEqual(M.meanAbsDiff(a, b), 2, 'mean absolute difference is correct');
}
console.log('mask-motion: all assertions passed');
