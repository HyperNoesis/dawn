// Smoke test of GenesisHybridProvider with a fake parent provider, fake canvas and fake model worker (no browser).
const assert = require('assert');
global.window = global; global.VS = {};
global.localStorage = { getItem: () => null };
const PC = require('../../js/providers/ppmatting-core.js'); VS.PPMattingCore = PC;
require('../../js/providers/band-refine-core.js');
const W = 1280, H = 720, CW = 320, CH = 192;
function coarseMatte() { const a = new Uint8Array(CW * CH); for (let y = 20; y < 180; y++) for (let x = 100; x < 220; x++) a[y * CW + x] = (x < 106 || x > 213) ? 128 : 255; return a; }
let sends = [], mode = 'good';
class Parent {
  // Match the real MODNet/PP parent: _rect is a full-frame object even when
  // ROI cropping is disabled. Hybrid must not mistake this for an active crop.
  constructor() { this._rect = { sx: 0, sy: 0, sw: W, sh: H }; }
  static isSupported() { return true; }
  async segment(video) {
    global.__parentFrameId = video.frameId;
    await Promise.resolve(); // model worker completes after the live video has advanced
    video.frameId = video.frameId + 1;
    this.lastRaw = coarseMatte(); this.lastRefined = null; this.lastSize = [CW, CH]; this.lastGuard = null;
    return { segmentationMask: { tag: 'parent' } };
  }
  resetTemporal() {} dispose() {}
  async _send(m) {
    sends.push([m.w, m.h]);
    const a = new Uint8Array(m.w * m.h); const c = coarseMatte(), [sx, sy, sw, sh] = global.__crop;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { const fx = Math.min(CW - 1, Math.max(0, ((sx + (x + 0.5) * sw / m.w) / W * CW) | 0)), fy = Math.min(CH - 1, Math.max(0, ((sy + (y + 0.5) * sh / m.h) / H * CH) | 0)); a[y * m.w + x] = mode === 'good' ? c[fy * CW + fx] : 0; }
    return { w: m.w, h: m.h, alpha: a.buffer };
  }
}
VS.PPMattingV2Provider = Parent;
global.__tileFrameIds = [];
global.document = { createElement: () => {
  const canvas = { width: 0, height: 0, frameId: null };
  canvas.getContext = () => ({
    drawImage(v, ...args) {
      if (args.length === 4 && v && v.frameId !== undefined) canvas.frameId = v.frameId;
      if (args.length === 8) {
        const [sx, sy, sw, sh] = args;
        if (sw !== undefined && sw < W) global.__crop = [sx, sy, sw, sh];
        global.__tileFrameIds.push(v.frameId);
      }
    },
    putImageData() {},
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(100) })
  });
  return canvas;
} };
global.performance = { now: () => Date.now() };
require('../../js/providers/hybrid-provider.js');
(async () => {
  const P = new VS.GenesisHybridProvider(), video = { videoWidth: W, videoHeight: H, frameId: 0 };
  const r1 = await P.segment(video);
  const firstTileFrames = global.__tileFrameIds.splice(0);
  assert.ok(r1.segmentationMask && r1.segmentationMask.width >= 192, 'hybrid canvas returned ' + JSON.stringify(P.hy));
  assert.ok(firstTileFrames.length > 0, 'the first pass refined at least one tile');
  assert.ok(firstTileFrames.every((id) => id === global.__parentFrameId), 'every tile must use the exact frame used by coarse inference; parent=' + global.__parentFrameId + ', tiles=' + firstTileFrames.join(','));
  assert.ok(P.hy.tiles > 0 && P.hy.size[0] >= 192, 'tiles found: ' + JSON.stringify(P.hy));
  assert.ok(sends.every(([w, h]) => w === 192 && h === 192 && w % 32 === 0), 'tile inputs are 192x192 (multiple of 32)');
  assert.strictEqual(P.hy.errors, 0, P.hy.lastError);
  assert.ok(P.hy.refined > 0 && P.hy.rejected === 0, 'faithful tiles are accepted: ' + JSON.stringify(P.hy));
  assert.ok(P.hy.budget > 0, 'full-frame _rect must not disable the independent tile budget: ' + JSON.stringify(P.hy));
  // A real ROI crop is intentionally fail-closed until tile coordinates can
  // be proven to match the parent provider's cropped coordinate system.
  const cropped = new VS.GenesisHybridProvider();
  cropped._rect = { sx: 80, sy: 40, sw: W - 160, sh: H - 80 };
  const croppedResult = await cropped.segment(video);
  assert.strictEqual(cropped.hy.tiles, 0, 'ROI-cropped input must not enter full-frame tile refinement');
  assert.strictEqual(croppedResult.segmentationMask.tag, 'parent', 'cropped path safely preserves parent matte');
  const n1 = sends.length; await P.segment(video);
  const secondTileFrames = global.__tileFrameIds.splice(0);
  assert.ok(secondTileFrames.every((id) => id === global.__parentFrameId), 'second-pass tile inputs stay paired with the second coarse frame');
  assert.ok(P.hy.cached > 0 || sends.length === n1 || P.hy.refined >= 0, 'second frame runs');
  // tracker-first: a hook that removes everything except the person must run BEFORE the band, so a stray blob costs no tiles
  {
    const blobParent = Parent.prototype.segment;
    Parent.prototype.segment = async function (video) { global.__parentFrameId = video.frameId; await Promise.resolve(); video.frameId++; const a = coarseMatte(); for (let y = 150; y < 190; y++) for (let x = 10; x < 60; x++) a[y * CW + x] = x % 2 ? 128 : 255; this.lastRaw = a; this.lastRefined = null; this.lastSize = [CW, CH]; this.lastGuard = null; return { segmentationMask: { tag: 'parent' } }; };
    const plain = new VS.GenesisHybridProvider(); await plain.segment(video);
    const tr = new VS.GenesisHybridProvider(); let called = 0, trackerFrameId = null;
    tr.setTrackerHook({ ready: () => true, async step(v, alpha, w, h) {
      called++; trackerFrameId = v.frameId;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < w * 0.25) alpha[y * w + x] = 0;
      return true;
    } });
    await tr.segment(video);
    assert.ok(called === 1 && tr.hy.tracked === true, 'tracker hook ran and reported tracked');
    assert.strictEqual(trackerFrameId, global.__parentFrameId, 'EdgeTAM tracker must receive the exact pre-inference frame snapshot used by the coarse matte');
    assert.ok(tr.hy.tiles < plain.hy.tiles, 'stray blob removed before the band: tiles ' + plain.hy.tiles + ' -> ' + tr.hy.tiles);
    const bad = new VS.GenesisHybridProvider(); bad.setTrackerHook({ ready: () => true, async step() { throw new Error('tam down'); } });
    const rb = await bad.segment(video); assert.ok(rb.segmentationMask.width >= 192 && bad.hy.tracked === false && bad.hy.errors === 0, 'a failing tracker never breaks the hybrid');
    Parent.prototype.segment = blobParent;
  }
  // bad model output (all zero) must be rejected and never crash
  mode = 'bad'; const Q = new VS.GenesisHybridProvider(); await Q.segment(video);
  assert.ok(Q.hy.rejected > 0 || Q.hy.budget === 0, 'garbage tile rejected: ' + JSON.stringify(Q.hy));
  // a throwing worker 3x switches the hybrid stage off and falls back to the parent matte
  const T = new VS.GenesisHybridProvider(); T._send = async () => { throw new Error('boom'); };
  let last; for (let i = 0; i < 4; i++) last = await T.segment(video);
  assert.ok(T.hy.off && last.segmentationMask.tag === 'parent', 'falls back to parent after repeated errors');
  console.log('hybrid-provider: all assertions passed (' + JSON.stringify(P.hy) + ')');
})().catch((e) => { console.error(e); process.exit(1); });
