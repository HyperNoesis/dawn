const assert = require('assert');
const store = {}; global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
global.window = global; const V = (global.VS = {});
class Seg { constructor() { this.kind = 'seg'; } }
class Worker_ extends Seg { constructor() { super(); this.kind = 'worker'; } static isSupported() { return true; } static threadsFor() { return 4; } }
V.MODNetSegmentationProvider = Seg; V.MODNetWorkerProvider = Worker_;
const M = require('../../js/providers/matte-engines.js'); M.installRouter(); M.installRouter();      // idempotent
const R = V.MODNetWorkerProvider;
assert.notStrictEqual(R, Worker_); assert.strictEqual(R.isSupported(), true); assert.strictEqual(R.threadsFor(), 4);
// default pref: original behaviour, instanceof intact
let a = new R(); assert.strictEqual(a.kind, 'worker'); assert.ok(a instanceof R && a instanceof Worker_ && a instanceof Seg);
// engine chosen but code not loaded yet -> safe fallback to MODNet
M.setPref('edgetam'); assert.strictEqual(new R().kind, 'worker');
// code loaded
V.BiRefNetSegmentationProvider = class { constructor() { this.kind = 'birefnet'; } }; V.ModelStore = {}; V.EdgeTAMCore = {}; V.TemporalMask = {};
V.PPMattingV2Provider = class { constructor() { this.kind = 'ppv2'; } static isSupported() { return true; } };
V.PPMattingHRNetProvider = class { constructor() { this.kind = 'pphr'; } static isSupported() { return true; } };
V.EdgeTAMGate = { create: (base) => ({ kind: 'edgetam', base }) };
assert.strictEqual(new R().kind, 'edgetam'); assert.strictEqual(new R().base.kind, 'worker');
M.setPref('birefnet'); assert.strictEqual(new R().kind, 'birefnet');
// v0.94 PP-Matting beta: only when the flag is on, supported and the device is not low-tier
M.setPref('ppmatting-v2'); assert.strictEqual(new R().kind, 'ppv2');
store.vs_pp_beta = '0'; assert.strictEqual(M.pref(), 'modnet', 'flag off: stored beta pick silently becomes MODNet'); assert.strictEqual(new R().kind, 'worker');
assert.ok(!M.visibleEngines().some((e) => e[0] === 'ppmatting-v2'), 'hidden when flag off');
delete store.vs_pp_beta; M.setPref('ppmatting-hrnet'); assert.strictEqual(M.pref(), 'modnet', 'HRNet hidden unless the lab switch is on');
store.vs_ppm_lab = '1'; M.setPref('ppmatting-hrnet'); assert.strictEqual(new R().kind, 'pphr'); delete store.vs_ppm_lab;
V.EnginePolicy = require('../../js/providers/engine-policy.js');
const setNav = (v) => Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true, writable: true });
setNav({ userAgent: 'Mozilla/5.0 (Linux; Android 13; Mobile)', hardwareConcurrency: 4, deviceMemory: 2 });
M.setPref('ppmatting-v2'); assert.strictEqual(new R().kind, 'worker', 'low-tier phone: default engine, not the beta');
store.vs_pp_force = '1'; assert.strictEqual(new R().kind, 'ppv2', 'force override for testing'); delete store.vs_pp_force;
setNav({ userAgent: 'Mozilla/5.0 (X11; Linux)', hardwareConcurrency: 8, deviceMemory: 8 }); assert.strictEqual(new R().kind, 'ppv2');
delete globalThis.navigator; delete V.EnginePolicy;
M.setPref('garbage'); assert.strictEqual(M.pref(), 'modnet'); assert.strictEqual(new R().kind, 'worker');
console.log('matte-engines: all assertions passed');
