const assert = require('assert');
const C = require('../../js/providers/edgetam-core.js');
const W = 64, H = 64;
const rect = (a, x0, y0, x1, y1, v) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * W + x] = v == null ? 255 : v; return a; };

// bbox uses the largest blob, ignores the small stray one
const base = new Uint8Array(W * H); rect(base, 10, 10, 40, 60); rect(base, 50, 2, 58, 10);
const bb = C.bboxFromAlpha(base, W, H, 128, 0.01);
assert.deepStrictEqual([bb.x0, bb.y0, bb.x1, bb.y1], [10, 10, 40, 60]); assert.strictEqual(bb.area, 30 * 50);
assert.strictEqual(C.bboxFromAlpha(new Uint8Array(W * H), W, H), null, 'empty matte -> null');
assert.strictEqual(C.bboxFromAlpha(rect(new Uint8Array(W * H), 0, 0, 2, 2), W, H, 128, 0.01), null, 'tiny matte -> null');

// prompt scaling to 1024 space, centroid hole is moved onto foreground
const ring = new Uint8Array(W * H); rect(ring, 10, 10, 50, 50); rect(ring, 25, 25, 35, 35, 0);
const rb = C.bboxFromAlpha(ring, W, H, 128, 0.01), pr = C.promptFromBox(rb, W, H, ring);
assert.deepStrictEqual(Array.from(pr.boxes), [160, 160, 800, 800]);
assert.ok(ring[Math.floor(pr.points[1] / 16) * W + Math.floor(pr.points[0] / 16)] >= 128, 'point must land on foreground');
assert.strictEqual(pr.labels[0], 1n);

// pixel values: ImageNet normalisation and CHW layout
const px = new Uint8ClampedArray(4 * 4); for (let i = 0; i < 4; i++) { px[i * 4] = 255; px[i * 4 + 1] = 0; px[i * 4 + 2] = 128; px[i * 4 + 3] = 255; }
const pv = C.toPixelValues(px, 2);
assert.strictEqual(pv.length, 12); assert.ok(Math.abs(pv[0] - (1 - 0.485) / 0.229) < 1e-5); assert.ok(Math.abs(pv[4] - (0 - 0.456) / 0.224) < 1e-5);

// pickBest / gateFromLogits
assert.strictEqual(C.pickBest([0.1, 0.9, 0.5]), 1);
assert.deepStrictEqual(Array.from(C.gateFromLogits(new Float32Array([-3, 0, 2]))), [0, 0, 255]);

// componentGate: keeps agreed blob WITHOUT cutting holes, drops the disagreeing blob
const gate = new Uint8Array(W * H); rect(gate, 12, 12, 38, 40);           // EdgeTAM only covers part of the person
const keep = C.componentGate(base, gate, W, H, 128, 0.3);
assert.strictEqual(keep[30 * W + 30], 255); assert.strictEqual(keep[58 * W + 20], 255, 'person pixels outside the gate are still kept');
assert.strictEqual(keep[5 * W + 54], 0, 'stray blob dropped');

// softGate grows then feathers, applyGate multiplies
const g2 = rect(new Uint8Array(W * H), 20, 20, 30, 30); const sg = C.softGate(g2, W, H, 3, 2);
assert.strictEqual(sg[25 * W + 25], 255); assert.ok(sg[25 * W + 17] > 0, 'dilated'); assert.ok(sg[25 * W + 10] === 0);
const edge = sg[25 * W + 32]; assert.ok(edge > 0 && edge < 255, 'feathered edge, got ' + edge);
const out = C.applyGate(Uint8Array.from([200, 200, 200]), Uint8Array.from([255, 128, 0])); assert.deepStrictEqual(Array.from(out), [200, 100, 0]);

// safety rules
assert.strictEqual(C.gateIsSafe(1000, 900, 5), true); assert.strictEqual(C.gateIsSafe(1000, 400, 5), false);
assert.strictEqual(C.gateIsSafe(1000, 900, -2), false, 'no object -> refuse'); assert.strictEqual(C.gateIsSafe(0, 0, 1), false);

// refreshGate with a fake ort: wiring, tensor names, dims
(async () => {
  const calls = [], disposed = { count: 0 };
  const output = (data, dims) => ({ data, dims, dispose() { disposed.count++; } });
  const ort = { Tensor: class {
    constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; }
    dispose() { disposed.count++; }
  } };
  const enc = { run: async (f) => {
    calls.push(['enc', f.pixel_values.dims]);
    return { a: output(null, [1]), b: output(null, [2]), c: output(null, [3]) };
  } };
  const dec = { run: async (f) => {
    calls.push(['dec', Object.keys(f), f.input_boxes.dims, f.input_points.dims, f.input_labels.type]);
    const m = new Float32Array(3 * 65536).fill(-5); for (let i = 0; i < 65536; i++) m[65536 + i] = 3;  // mask #1 = everything
    return {
      iou_scores: output([0.2, 0.9, 0.1], [1, 1, 3]),
      pred_masks: output(m, [1, 1, 3, 256, 256]),
      object_score_logits: output([4], [1, 1, 1])
    };
  } };
  const r = await C.refreshGate(ort, enc, dec, new Uint8ClampedArray(1024 * 1024 * 4), base, W, H);
  assert.deepStrictEqual(calls[0], ['enc', [1, 3, 1024, 1024]]);
  assert.deepStrictEqual(calls[1].slice(1), [['input_points', 'input_labels', 'input_boxes', 'image_embeddings.0', 'image_embeddings.1', 'image_embeddings.2'], [1, 1, 4], [1, 1, 1, 2], 'int64']);
  assert.strictEqual(r.iou, 0.9); assert.strictEqual(r.gate[0], 255); assert.strictEqual(r.obj, 4);
  assert.strictEqual(disposed.count, 10, 'all four input tensors and six encoder/decoder output tensors are disposed after extraction');
  assert.strictEqual(await C.refreshGate(ort, enc, dec, new Uint8ClampedArray(4), new Uint8Array(W * H), W, H), null);
  console.log('edgetam-core: all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
