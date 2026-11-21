// Plumbing test for the Proxy wrapper with fake DOM/ort/base provider. The model maths is covered by edgetam-core tests + the real-model cross-check.
const assert = require('assert');
const G = 256;
const ops = [];
class FakeCtx { constructor(c) { this.canvas = c; this.globalCompositeOperation = 'source-over'; this.lastDraw = null; }
  drawImage(src, ...args) {
    this.canvas._last = src; this.lastDraw = { src, args }; ops.push(this.globalCompositeOperation);
    const sourceFrameId = src && (src._sourceFrameId !== undefined ? src._sourceFrameId : src.frameId);
    if (sourceFrameId !== undefined) this.canvas._sourceFrameId = sourceFrameId;
  }
  fillRect() {}
  clearRect() {}
  createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  putImageData(img) { this.canvas._img = img; }
  getImageData(x, y, w, h) {
    const d = new Uint8ClampedArray(w * h * 4), draw = this.lastDraw;
    const src = draw && draw.src;
    if (src && src._alpha) {
      // Respect drawImage(image, dx, dy, dw, dh) so aspect-padded alpha is
      // rasterised at its real destination size instead of stretched to fill
      // the square backing canvas.
      const a = draw.args, dx = a.length === 4 ? a[0] : 0, dy = a.length === 4 ? a[1] : 0;
      const dw = a.length === 4 ? a[2] : (src.width || w), dh = a.length === 4 ? a[3] : (src.height || h);
      const sw = src.width || dw, sh = src.height || dh;
      for (let yy = 0; yy < Math.min(h, dh); yy++) for (let xx = 0; xx < Math.min(w, dw); xx++) {
        const sx = Math.min(sw - 1, Math.floor(xx * sw / dw));
        const sy = Math.min(sh - 1, Math.floor(yy * sh / dh));
        const p = (yy + dy - y) * w + (xx + dx - x);
        if (p >= 0 && p < w * h) d[p * 4 + 3] = src._alpha[sy * sw + sx] || 0;
      }
    }
    return { data: d };
  }
}
const made = [];
global.document = { createElement: () => { const c = { width: 0, height: 0 }; c.getContext = () => (c._ctx = c._ctx || new FakeCtx(c)); made.push(c); return c; } };
global.window = global; global.navigator = { gpu: {} };
global.ort = { Tensor: class { constructor(t, d, dims) { this.type = t; this.data = d; this.dims = dims; } }, InferenceSession: { create: async () => ({ release() {} }) } };
const V = (global.VS = {}); require('../../js/providers/edgetam-core.js');
let loadFail = false, failWebGPU = false;
const loadedModelIds = [], providerRequests = [];
V.loadOrt = async () => {};
V.ModelStore = {
  load: async (id) => {
    loadedModelIds.push(id);
    if (loadFail) throw new Error('offline');
    if (id === 'edgetam-fp32') {
      return {
        bytes: { enc: 5, dec: 2, e_data: 6, d_data: 4 },
        entry: { encoder: 'enc', decoder: 'dec', external: { 'vision_encoder.onnx_data': 'e_data', 'prompt_encoder_mask_decoder.onnx_data': 'd_data' } }
      };
    }
    return {
      bytes: { enc: 1, dec: 2, e_data: 3, d_data: 4 },
      entry: { encoder: 'enc', decoder: 'dec', external: { 'vision_encoder_fp16.onnx_data': 'e_data', 'prompt_encoder_mask_decoder.onnx_data': 'd_data' } }
    };
  }
};
// make fake sessions: EdgeTAM says mask = left half only.
ort.InferenceSession.create = async (bytes, options) => {
  providerRequests.push({ bytes, providers: options && options.executionProviders });
  if (failWebGPU && options && options.executionProviders && options.executionProviders.includes('webgpu')) {
    throw new Error('WebGPU unsupported by this adapter');
  }
  return (bytes === 1 || bytes === 5)
    ? { run: async () => ({ a: {}, b: {}, c: {} }), release() {} }
    : { run: async () => { const m = new Float32Array(3 * 65536).fill(-5); for (let k = 0; k < 3; k++) for (let y = 0; y < G; y++) for (let x = 0; x < 128; x++) m[k * 65536 + y * G + x] = 4; return { iou_scores: { data: [0.5, 0.9, 0.4] }, pred_masks: { data: m }, object_score_logits: { data: [5] } }; }, release() {} };
};
class Base { constructor() { this.label = 'MODNet'; this.longEdge = 320; this.lowLightBoost = false; this.calls = 0; this.sourceFrameIds = []; }
  async initialize() { return 'inited'; }
  async segment(video) {
    this.calls++;
    this.sourceFrameIds.push(video && (video._sourceFrameId !== undefined ? video._sourceFrameId : video.frameId));
    await Promise.resolve(); // let the simulated live camera advance during inference
    if (global.__liveVideo) global.__liveVideo.frameId++;
    const mask = { width: G, height: 192, _alpha: new Uint8Array(G * 192) };
    for (let y = 0; y < 192; y++) { for (let x = 20; x < 100; x++) mask._alpha[y * G + x] = 255; for (let x = 200; x < 240; x++) if (y > 20 && y < 80) mask._alpha[y * G + x] = 255; }
    return { segmentationMask: mask, extra: 1 };
  }
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
  const liveVideo = { videoWidth: 640, videoHeight: 480, frameId: 17 }; global.__liveVideo = liveVideo;
  const r1 = await p.segment(liveVideo); assert.strictEqual(r1.extra, 1);
  assert.strictEqual(base.sourceFrameIds[0], 17, 'base model receives the captured camera frame');
  assert.strictEqual(made[1]._sourceFrameId, 17, 'EdgeTAM encoder refresh receives that exact same frame');
  assert.strictEqual(liveVideo.frameId, 18, 'fake camera advances while base inference is pending');
  assert.ok(p.edgetam.gateActive, 'first frame awaits the first refresh: ' + JSON.stringify(p.edgetam)); assert.ok(ops.includes('destination-in'), 'gate composited');
  const r2 = await p.segment(liveVideo); assert.ok(r2.segmentationMask && r2.segmentationMask !== base._last);
  // the stray right blob was agreed away by the gate -> output alpha (read back through the fake) has nothing at x>=200
  const gateAlpha = made[3]._img.data;   // canvases: source snapshot, frame, base, gate, out
  const at = (x, y) => gateAlpha[(y * G + x) * 4 + 3];
  assert.strictEqual(at(220, 50), 0, 'stray blob removed from the composited gate'); assert.strictEqual(at(50, 120), 255, 'person kept');

  // Hybrid owns a same-frame snapshot internally. If its tracker reports that
  // the first gate was not safe, EdgeTAM's wrapper fallback must reuse that
  // exact Hybrid snapshot, not the now-advanced live camera.
  class HybridLike extends Base {
    constructor() { super(); this.hy = { tracked: false }; }
    setTrackerHook(hook) { this.trackerHook = hook; }
    async segment(video) {
      this.calls++;
      this._hyLastFrame = { videoWidth: video.videoWidth, videoHeight: video.videoHeight, frameId: video.frameId };
      await Promise.resolve();
      if (global.__liveVideo) global.__liveVideo.frameId++;
      const mask = { width: G, height: 192, _alpha: new Uint8Array(G * 192) };
      for (let y = 0; y < 192; y++) for (let x = 20; x < 100; x++) mask._alpha[y * G + x] = 255;
      return { segmentationMask: mask, extra: 2 };
    }
  }
  const beforeHybridCanvases = made.length;
  const hybridBase = new HybridLike(), hybridGate = E.create(hybridBase, { refreshEvery: 4 });
  await hybridGate.initialize();
  liveVideo.frameId = 42;
  const hybridResult = await hybridGate.segment(liveVideo);
  assert.strictEqual(hybridResult.extra, 2, 'Hybrid fallback keeps the provider result');
  assert.strictEqual(liveVideo.frameId, 43, 'fake camera advances during Hybrid inference');
  assert.strictEqual(hybridBase._hyLastFrame.frameId, 42, 'Hybrid retains its inference source frame');
  assert.strictEqual(made[beforeHybridCanvases]._sourceFrameId, 42, 'EdgeTAM fallback refresh uses Hybrid source frame, not live video');
  hybridGate.dispose();

  // navigator.gpu can exist even when the adapter cannot compile EdgeTAM's
  // fp16 graph. The provider must retry the fp32/WASM checkpoint and report
  // that it deliberately downgraded precision/runtime rather than failing.
  failWebGPU = true;
  const fallbackBase = new Base(), fallbackGate = E.create(fallbackBase);
  await fallbackGate.initialize();
  assert.strictEqual(fallbackGate.edgetam.status, 'ready', 'fp32/WASM retry keeps EdgeTAM available');
  assert.strictEqual(fallbackGate.edgetam.modelId, 'edgetam-fp32', 'fp32 checkpoint selected after WebGPU rejection');
  assert.strictEqual(fallbackGate.edgetam.runtime, 'wasm', 'fp32 retry uses the WASM runtime');
  assert.deepStrictEqual(providerRequests.find((r) => r.bytes === 1).providers, ['webgpu'],
    'FP16 EdgeTAM must request WebGPU only, never silently fall through to WASM');
  assert.deepStrictEqual(providerRequests.find((r) => r.bytes === 5).providers, ['wasm'],
    'the explicit FP32 model is the portable WASM fallback');
  assert.match(fallbackGate.edgetam.precisionFallback, /WebGPU unsupported/, 'fallback reason remains visible');
  assert.deepStrictEqual(loadedModelIds.slice(-2), ['edgetam', 'edgetam-fp32'], 'accelerated candidate is attempted before portable fallback');
  const fallbackVideo = { videoWidth: 640, videoHeight: 480, frameId: 77 };
  const fallbackResult = await fallbackGate.segment(fallbackVideo);
  assert.ok(fallbackResult.segmentationMask, 'fp32/WASM fallback still returns a gated matte');
  assert.ok(fallbackGate.edgetam.gateActive, 'fp32/WASM fallback builds an active gate');
  fallbackGate.dispose();
  failWebGPU = false;

  // A missing/unsafe subject gate is retried at the configured cadence rather
  // than rerunning the expensive encoder on every camera frame.
  const originalRefreshGate = V.EdgeTAMCore.refreshGate;
  let emptyGateAttempts = 0;
  V.EdgeTAMCore.refreshGate = async () => { emptyGateAttempts++; return null; };
  const emptyBase = new Base(), emptyGate = E.create(emptyBase, { refreshEvery: 4 });
  await emptyGate.initialize();
  const emptyVideo = { videoWidth: 640, videoHeight: 480, frameId: 100 };
  for (let i = 0; i < 4; i++) await emptyGate.segment(emptyVideo);
  assert.strictEqual(emptyGateAttempts, 1, 'a missing first gate does not trigger per-frame EdgeTAM inference');
  for (let i = 0; i < 4; i++) await emptyGate.segment(emptyVideo);
  assert.strictEqual(emptyGateAttempts, 2, 'a missing gate is retried after the configured interval');
  emptyGate.dispose();
  V.EdgeTAMCore.refreshGate = originalRefreshGate;

  p.dispose(); assert.strictEqual(base.disposed, true);
  // failure path: model load fails -> pass-through, never throws
  loadFail = true; const b2 = new Base(), p2 = E.create(b2); await p2.initialize();
  assert.strictEqual(p2.edgetam.status, 'failed'); assert.match(p2.edgetam.error, /offline/); assert.match(p2.label, /cleanup unavailable/);
  const r = await p2.segment({}); assert.ok(r.segmentationMask._alpha, 'base mask passed through untouched'); assert.strictEqual(b2.calls, 1);
  const failedHybridBase = new HybridLike(), failedHybrid = E.create(failedHybridBase);
  await failedHybrid.initialize();
  assert.match(failedHybrid.label, /Genesis Hybrid/, 'a failed EdgeTAM wrapper reports the actual Hybrid fallback identity');
  assert.doesNotMatch(failedHybrid.label, /Genesis UltraMatte/, 'a failed tracker is never labelled as full UltraMatte');
  failedHybrid.dispose();
  loadFail = false;
  console.log('edgetam-provider: all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
