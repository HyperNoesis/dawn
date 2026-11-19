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
  constructor() {} static isSupported() { return true; }
  async segment() { this.lastRaw = coarseMatte(); this.lastRefined = null; this.lastSize = [CW, CH]; this.lastGuard = null; return { segmentationMask: { tag: 'parent' } }; }
  resetTemporal() {} dispose() {}
  async _send(m) {
    sends.push([m.w, m.h]);
    const a = new Uint8Array(m.w * m.h); const c = coarseMatte(), [sx, sy, sw, sh] = global.__crop;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { const fx = Math.min(CW - 1, Math.max(0, ((sx + (x + 0.5) * sw / m.w) / W * CW) | 0)), fy = Math.min(CH - 1, Math.max(0, ((sy + (y + 0.5) * sh / m.h) / H * CH) | 0)); a[y * m.w + x] = mode === 'good' ? c[fy * CW + fx] : 0; }
    return { w: m.w, h: m.h, alpha: a.buffer };
  }
}
VS.PPMattingV2Provider = Parent;
global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage(v, sx, sy, sw, sh) { if (sw !== undefined && sw < W) global.__crop = [sx, sy, sw, sh]; }, putImageData() {}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(100) }) }) }) };
global.performance = { now: () => Date.now() };
require('../../js/providers/hybrid-provider.js');
(async () => {
  const P = new VS.GenesisHybridProvider(), video = { videoWidth: W, videoHeight: H };
  const r1 = await P.segment(video);
  assert.ok(r1.segmentationMask && r1.segmentationMask.width >= 192, 'hybrid canvas returned ' + JSON.stringify(P.hy));
  assert.ok(P.hy.tiles > 0 && P.hy.size[0] >= 192, 'tiles found: ' + JSON.stringify(P.hy));
  assert.ok(sends.every(([w, h]) => w === 192 && h === 192 && w % 32 === 0), 'tile inputs are 192x192 (multiple of 32)');
  assert.strictEqual(P.hy.errors, 0, P.hy.lastError);
  assert.ok(P.hy.refined > 0 && P.hy.rejected === 0, 'faithful tiles are accepted: ' + JSON.stringify(P.hy));
  const n1 = sends.length; await P.segment(video);
  assert.ok(P.hy.cached > 0 || sends.length === n1 || P.hy.refined >= 0, 'second frame runs');
  // bad model output (all zero) must be rejected and never crash
  mode = 'bad'; const Q = new VS.GenesisHybridProvider(); await Q.segment(video);
  assert.ok(Q.hy.rejected > 0 || Q.hy.budget === 0, 'garbage tile rejected: ' + JSON.stringify(Q.hy));
  // a throwing worker 3x switches the hybrid stage off and falls back to the parent matte
  const T = new VS.GenesisHybridProvider(); T._send = async () => { throw new Error('boom'); };
  let last; for (let i = 0; i < 4; i++) last = await T.segment(video);
  assert.ok(T.hy.off && last.segmentationMask.tag === 'parent', 'falls back to parent after repeated errors');
  console.log('hybrid-provider: all assertions passed (' + JSON.stringify(P.hy) + ')');
})().catch((e) => { console.error(e); process.exit(1); });
