const assert = require('assert');
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); }
};
global.window = global;
const V = (global.VS = {});

class Seg { constructor() { this.kind = 'seg'; } }
class Worker_ extends Seg {
  constructor() { super(); this.kind = 'worker'; }
  static isSupported() { return true; }
  static threadsFor() { return 4; }
}
V.MODNetSegmentationProvider = Seg;
V.MODNetWorkerProvider = Worker_;

// Load the pure dependency policy just as the browser's dynamic loader does.
V.MatteEnginePolicy = require('../../js/providers/matte-engine-policy.js');
const M = require('../../js/providers/matte-engines.js');
M.installRouter(); M.installRouter();      // idempotent
const R = V.MODNetWorkerProvider;
assert.notStrictEqual(R, Worker_);
assert.strictEqual(R.isSupported(), true);
assert.strictEqual(R.threadsFor(), 4);

// First-run preference is the advanced local route. Before its optional
// dependencies load, the router must report that exact route as unavailable
// rather than silently pretending the original model is running.
assert.strictEqual(M.pref(), 'genesis-hybrid-tam');
const unavailableDefault = new R();
assert.strictEqual(unavailableDefault.requestedEngine, 'genesis-hybrid-tam');
assert.match(unavailableDefault.label, /unavailable/i);

(async () => {
  await assert.rejects(unavailableDefault.initialize(), /Missing/);

  // An explicit MODNet choice remains authoritative and retains instanceof.
  M.setPref('modnet');
  let a = new R();
  assert.strictEqual(a.kind, 'worker');
  assert.ok(a instanceof R && a instanceof Worker_ && a instanceof Seg);

  // Explicit EdgeTAM selection with missing dependencies must also fail
  // visibly, not silently claim that the selected engine is running.
  delete V.EdgeTAMCore;
  delete V.EdgeTAMGate;
  M.setPref('edgetam');
  const unavailable = new R();
  assert.strictEqual(unavailable.requestedEngine, 'edgetam');
  assert.match(unavailable.label, /unavailable/i);
  await assert.rejects(unavailable.initialize(), /Missing/);

  // Once the exact EdgeTAM dependencies are available, construct that route.
  V.ModelStore = {};
  V.EdgeTAMCore = {};
  V.EdgeTAMGate = { create: (base) => ({ kind: base.kind === 'hybrid' ? 'ultramatte' : 'edgetam', base }) };
  assert.strictEqual(new R().kind, 'edgetam');
  assert.strictEqual(new R().base.kind, 'worker');

  // BiRefNet needs its own runtime dependencies, but no unrelated provider.
  V.BiRefNetSegmentationProvider = class { constructor() { this.kind = 'birefnet'; } };
  V.TemporalMask = {};
  M.setPref('birefnet');
  assert.strictEqual(new R().kind, 'birefnet');

  // PP-MattingV2 is independent of BiRefNet/EdgeTAM. It needs only its own
  // model store, tensor preprocessing and temporal-matte stack.
  V.PPMattingCore = {};
  V.TemporalMatte = {};
  V.PPMattingV2Provider = class { constructor() { this.kind = 'ppv2'; } static isSupported() { return true; } };
  V.PPMattingHRNetProvider = class { constructor() { this.kind = 'pphr'; } static isSupported() { return true; } };
  M.setPref('ppmatting-v2');
  assert.strictEqual(new R().kind, 'ppv2');

  // Beta flag off: a stored beta choice resolves to MODNet and hides the option.
  store.vs_pp_beta = '0';
  assert.strictEqual(M.pref(), 'modnet');
  assert.strictEqual(new R().kind, 'worker');
  assert.ok(!M.visibleEngines().some((e) => e[0] === 'ppmatting-v2'));
  delete store.vs_pp_beta;

  // Once the full dependency graph is registered, the automatic default
  // resolves to the advanced route and constructs EdgeTAM around Hybrid.
  V.BandRefineCore = {};
  V.GenesisHybridProvider = class { constructor() { this.kind = 'hybrid'; this.longEdge = 384; } static isSupported() { return true; } };
  delete store.vs_matte_engine;
  assert.strictEqual(M.pref(), 'genesis-hybrid-tam');
  assert.strictEqual(new R().kind, 'ultramatte');

  // HRNet is visible only when the explicit lab switch is on. A stored but
  // hidden HRNet preference falls back to the adaptive first-run default.
  store.vs_matte_engine = 'ppmatting-hrnet';
  assert.strictEqual(M.pref(), 'genesis-hybrid-tam');
  assert.strictEqual(new R().kind, 'ultramatte');
  store.vs_ppm_lab = '1';
  M.setPref('ppmatting-hrnet');
  assert.strictEqual(new R().kind, 'pphr');
  delete store.vs_ppm_lab;

  // Device tier is not a hidden engine-selection gate. Actual speed is judged
  // by the runtime benchmark/governor after the provider has been constructed.
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Mozilla/5.0 (Linux; Android 13; Mobile)', hardwareConcurrency: 4, deviceMemory: 2 },
    configurable: true, writable: true
  });
  M.setPref('ppmatting-v2');
  assert.strictEqual(new R().kind, 'ppv2', 'explicit selection is constructed; measured performance decides whether it can stay live');

  // Corrupt persisted values safely resolve to the advanced adaptive default.
  store.vs_matte_engine = 'garbage';
  assert.strictEqual(M.pref(), 'genesis-hybrid-tam');
  assert.strictEqual(new R().kind, 'ultramatte');
  delete globalThis.navigator;

  console.log('matte-engines: all assertions passed');
  const ids = M.ENGINES.map((e) => e[0]);
  assert.ok(ids.includes('genesis-hybrid') && ids.includes('genesis-hybrid-tam'), 'hybrid engines are registered');
  assert.ok(M.visibleEngines().some((e) => e[0] === 'genesis-hybrid-tam') === M.betaOn(), 'hybrid+EdgeTAM follows the beta flag');
  console.log('matte-engines: hybrid engines registered');
})().catch((error) => { console.error(error); process.exitCode = 1; });
