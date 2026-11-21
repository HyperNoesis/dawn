// Plumbing test for the Proxy wrapper with fake DOM/ort/base provider. The model maths is covered by edgetam-core tests + the real-model cross-check.
const assert = require('assert');
const G = 256;
const ops = [];
class FakeCtx { constructor(c) { this.canvas = c; this.globalCompositeOperation = 'source-over'; }
  drawImage(src) { this.canvas._last = src; ops.push(this.globalCompositeOperation); }
  fillRect() {}
  clearRect() {} createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  putImageData(img) { this.canvas._img = img; }
  getImageData(x, y, w, h) { const d = new Uint8ClampedArray(w * h * 4); const s = this.canvas._last; if (s && s._alpha) for (let i = 0; i < w * h; i++) d[i * 4 + 3] = s._alpha[i]; return { data: d }; } }
const made = [];
global.document = { createElement: () => { const c = { width: 0, height: 0 }; c.getContext = () => (c._ctx = c._ctx || new FakeCtx(c)); made.push(c); return c; } };
global.window = global; global.navigator = { gpu: {} };
global.ort = { Tensor: class { constructor(t, d, dims) { this.type = t; this.data = d; this.dims = dims; } }, InferenceSession: { create: async () => ({ release() {} }) } };
const V = (global.VS = {}); require('../../js/providers/edgetam-core.js');
let loadFail = false;
V.loadOrt = async () => {};
V.ModelStore = { load: async () => { if (loadFail) throw new Error('offline'); return { bytes: { enc: 1, dec: 2, e_data: 3, d_data: 4 }, entry: { encoder: 'enc', decoder: 'dec', external: { 'vision_encoder_fp16.onnx_data': 'e_data', 'prompt_encoder_mask_decoder.onnx_data': 'd_data' } } }; } };
// make fake sessions: person on the left covers whole 256 grid left half; EdgeTAM says mask = left half only
ort.InferenceSession.create = async (bytes) => (bytes === 1
  ? { run: async () => ({ a: {}, b: {}, c: {} }), release() {} }
  : { run: async () => { const m = new Float32Array(3 * 65536).fill(-5); for (let k = 0; k < 3; k++) for (let y = 0; y < G; y++) for (let x = 0; x < 128; x++) m[k * 65536 + y * G + x] = 4; return { iou_scores: { data: [0.5, 0.9, 0.4] }, pred_masks: { data: m }, object_score_logits: { data: [5] } }; }, release() {} });
class Base { constructor() { this.label = 'MODNet'; this.longEdge = 320; this.lowLightBoost = false; this.calls = 0; }
  async initialize() { return 'inited'; } async segment() { this.calls++; const mask = { width: G, height: 192, _alpha: new Uint8Array(G * 192) };
    for (let y = 0; y < 192; y++) { for (let x = 20; x < 100; x++) mask._alpha[y * G + x] = 255; for (let x = 200; x < 240; x++) if (y > 20 && y < 80) mask._alpha[y * G + x] = 255; } return { segmentationMask: mask, extra: 1 }; }
  dispose() { this.disposed = true; } }
const E = require('../../js/providers/edgetam-provider.js');

// The SAM2/EdgeTAM square encoder must preserve source aspect ratio. These
// tests cover landscape and portrait padding and the inverse matte mapping.
assert.deepStrictEqual(E.fitRect(1920, 1080, 1024), { x: 0, y: 0, width: 1024, height: 576 });
assert.deepStrictEqual(E.fitRect(1080, 1920, 1024), { x: 0, y: 0, width: 576, height: 1024 });
{
  const alpha = new Uint8Array(640 * 360).fill(255);
  const fitted = E.fitAlpha(alpha, 640, 360, G);
  assert.strictEqual(fitted.length, G * G);
  assert.strictEqual(fitted[80 * G + 128], 255, 'landscape content is retained inside its fitted rectangle');
  assert.strictEqual(fitted[220 * G + 128], 0, 'landscape padding stays transparent');
  const restored = E.unfitAlpha(fitted, 640, 360, G);
  assert.ok(restored.every((v) => v === 255), 'unpadding returns the full native matte without border loss');
  const portrait = E.fitRect(360, 640, G);
  assert.deepStrictEqual(portrait, { x: 0, y: 0, width: 144, height: 256 });
}

(async () => {
  const base = new Base(), p = E.create(base, { refreshEvery: 4 });
  assert.ok(p instanceof Base, 'instanceof preserved'); assert.strictEqual(p.longEdge, 320);
  p.lowLightBoost = true; assert.strictEqual(base.lowLightBoost, true, 'writes go to the base');
  assert.strictEqual(await p.initialize(), 'inited'); assert.strictEqual(p.edgetam.status, 'ready');
  assert.match(p.label, /MODNet \+ EdgeTAM cleanup/);
  const r1 = await p.segment({ videoWidth: 640, videoHeight: 480 }); assert.strictEqual(r1.extra, 1);
  assert.ok(p.edgetam.gateActive, 'first frame awaits the first refresh'); assert.ok(ops.includes('destination-in'), 'gate composited');
  const r2 = await p.segment({ videoWidth: 640, videoHeight: 480 }); assert.ok(r2.segmentationMask && r2.segmentationMask !== base._last);
  // the stray right blob was agreed away by the gate -> output alpha (read back through the fake) has nothing at x>=200
  const gateAlpha = made[2]._img.data;   // canvases are created in order: frame, base, gate, out
  const at = (x, y) => gateAlpha[(y * G + x) * 4 + 3];
  assert.strictEqual(at(220, 50), 0, 'stray blob removed from the composited gate'); assert.strictEqual(at(50, 120), 255, 'person kept');
  p.dispose(); assert.strictEqual(base.disposed, true);
  // failure path: model load fails -> pass-through, never throws
  loadFail = true; const b2 = new Base(), p2 = E.create(b2); await p2.initialize();
  assert.strictEqual(p2.edgetam.status, 'failed'); assert.match(p2.edgetam.error, /offline/); assert.match(p2.label, /cleanup unavailable/);
  const r = await p2.segment({}); assert.ok(r.segmentationMask._alpha, 'base mask passed through untouched'); assert.strictEqual(b2.calls, 1);
  console.log('edgetam-provider: all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
