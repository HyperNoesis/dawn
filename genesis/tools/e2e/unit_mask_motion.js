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

{
  assert.strictEqual(M.compositionPolicy('warped', null), 'warp', 'reliable motion may warp the matte');
  assert.strictEqual(M.compositionPolicy('low-confidence', 'low-confidence'), 'hold', 'uncertain motion holds the unwarped model matte');
  assert.strictEqual(M.compositionPolicy('awaiting-new-mask', 'low-confidence'), 'hold', 'low-confidence suspension keeps the unwarped matte');
  for (const status of ['stale-mask', 'scene-cut', 'frame-gap']) {
    assert.strictEqual(M.compositionPolicy(status, status), 'passthrough', status + ' must pass through the real camera');
    assert.strictEqual(M.compositionPolicy('awaiting-new-mask', status), 'passthrough', 'suspension after ' + status + ' must remain pass-through');
  }
  assert.strictEqual(M.compositionPolicy('some-future-state', null), 'passthrough', 'unknown states fail closed');
}

// Exercise the stateful browser wrapper with a deterministic canvas shim. This
// catches stale/suspended-state bugs and repeated full-resolution canvas leaks,
// not just the pure block-flow mathematics above.
{
  const previousDocument = global.document;
  const previousPerformance = global.performance;
  let clock = 1000;
  const allocations = [];
  function makeCanvas() {
    let width = 0, height = 0, ctx = null;
    const canvas = {};
    Object.defineProperties(canvas, {
      width: { get: () => width, set: (v) => { width = v; ctx = null; } },
      height: { get: () => height, set: (v) => { height = v; ctx = null; } }
    });
    canvas.getContext = () => {
      if (!ctx) {
        ctx = {
          source: null,
          drawImage(source) { this.source = source; },
          getImageData() {
            const data = new Uint8ClampedArray(width * height * 4);
            const source = this.source || {};
            if (source.luma && source.luma.length === width * height) {
              for (let i = 0; i < source.luma.length; i++) {
                const p = i * 4, v = source.luma[i];
                data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255;
              }
            } else if (source.alpha && source.alpha.length === width * height) {
              for (let i = 0; i < source.alpha.length; i++) data[i * 4 + 3] = source.alpha[i];
            }
            return { data };
          },
          createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
          putImageData(image) { this.lastImageData = image; }
        };
      }
      return ctx;
    };
    return canvas;
  }
  global.document = { createElement(tag) { assert.strictEqual(tag, 'canvas'); const c = makeCanvas(); allocations.push(c); return c; } };
  global.performance = { now: () => clock };

  const mm = new M.MaskMotion();
  const fullMask = { width: W, height: H, alpha: new Uint8Array(W * H).fill(255) };
  const textured = { width: W, height: H, luma: pattern(431) };
  mm.seed(fullMask, textured, clock);
  const firstCanvasCount = allocations.length;
  mm.seed(fullMask, textured, clock + 1);
  assert.strictEqual(allocations.length, firstCanvasCount, 'same-sized reseeds reuse the analysis, seed and output canvases');

  clock += 20;
  mm.advance(textured, clock);
  assert.strictEqual(mm.getMetrics().status, 'warped', 'textured, same-scene frames produce a trusted alignment');

  const sceneCut = { width: W, height: H, luma: new Uint8Array(W * H).fill(255) };
  clock += 20;
  mm.advance(sceneCut, clock);
  assert.strictEqual(mm.getMetrics().status, 'scene-cut', 'large frame appearance changes suspend propagation');
  assert.strictEqual(M.compositionPolicy(mm.getMetrics().status, mm.getMetrics().reason), 'passthrough', 'scene cuts cannot reuse the old silhouette');
  clock += 20;
  mm.advance(sceneCut, clock);
  assert.strictEqual(M.compositionPolicy(mm.getMetrics().status, mm.getMetrics().reason), 'passthrough', 'scene-cut suspension remains pass-through until reseeded');

  mm.seed(fullMask, textured, clock);
  clock += M.DEFAULTS.maxMaskAgeMs + 1;
  mm.advance(textured, clock);
  assert.strictEqual(mm.getMetrics().status, 'stale-mask', 'mask age is bounded from delivery time');
  assert.strictEqual(M.compositionPolicy(mm.getMetrics().status, mm.getMetrics().reason), 'passthrough', 'expired mattes are never composited');
  clock += 10;
  mm.advance(textured, clock);
  assert.strictEqual(M.compositionPolicy(mm.getMetrics().status, mm.getMetrics().reason), 'passthrough', 'expired-mask suspension stays pass-through');

  mm.seed(fullMask, textured, clock);
  clock += M.DEFAULTS.maxFrameGapMs + 1;
  mm.advance(textured, clock);
  assert.strictEqual(mm.getMetrics().status, 'frame-gap', 'large capture gaps invalidate motion alignment');
  assert.strictEqual(M.compositionPolicy(mm.getMetrics().status, mm.getMetrics().reason), 'passthrough', 'frame gaps cannot reuse stale coordinates');

  const flat = { width: W, height: H, luma: new Uint8Array(W * H).fill(100) };
  mm.seed(fullMask, flat, clock);
  clock += 20;
  mm.advance(flat, clock);
  assert.strictEqual(mm.getMetrics().status, 'low-confidence', 'flat scenes refuse to invent motion');
  assert.strictEqual(M.compositionPolicy(mm.getMetrics().status, mm.getMetrics().reason), 'hold', 'low confidence holds the last unwarped model matte');
  clock += 20;
  mm.advance(flat, clock);
  assert.strictEqual(M.compositionPolicy(mm.getMetrics().status, mm.getMetrics().reason), 'hold', 'low-confidence suspension continues holding the base matte');

  mm.dispose();
  global.document = previousDocument;
  global.performance = previousPerformance;
}

console.log('mask-motion: all assertions passed');
