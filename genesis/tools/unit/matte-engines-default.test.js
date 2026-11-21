'use strict';
const assert = require('assert');

global.window = global;
global.VS = {
  MODNetWorkerProvider: class MODNetWorkerProvider {
    static isSupported() { return true; }
  },
  MODNetSegmentationProvider: class MODNetSegmentationProvider {}
};
const VS = global.VS;
const storage = new Map();
global.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); }
};

require('../../js/providers/matte-engine-policy.js');
const EdgeTAMGate = { create(provider) { return { wrapped: provider }; } };
VS.ModelStore = {};
VS.TemporalMatte = {};
VS.PPMattingCore = {};
VS.PPMattingV2Provider = class PPMattingV2Provider {};
VS.BandRefineCore = {};
VS.GenesisHybridProvider = class GenesisHybridProvider {};
VS.EdgeTAMCore = {};
VS.EdgeTAMGate = EdgeTAMGate;
VS.BiRefNetSegmentationProvider = class BiRefNetSegmentationProvider {};
VS.PPMattingHRNetProvider = class PPMattingHRNetProvider {};

const MatteEngines = require('../../js/providers/matte-engines.js');

assert.strictEqual(MatteEngines.defaultEngine(), 'modnet', 'the safe local matting route is the immediate default');
assert.strictEqual(MatteEngines.pref(), 'modnet', 'no saved choice starts on MODNet');
assert.strictEqual(MatteEngines.isAutomaticDefault(), true, 'first-run MODNet remains an automatic selection');

// Legacy explicit preferences remain explicit until the new picker is changed.
storage.set('vs_live_engine', 'rvm');
assert.strictEqual(MatteEngines.isAutomaticDefault(), false, 'legacy explicit RVM does not get silently replaced by Automatic');
storage.set('vs_live_engine', 'modnet');
assert.strictEqual(MatteEngines.isAutomaticDefault(), false, 'legacy explicit MODNet is preserved');
storage.set('vs_live_engine', 'light');
assert.strictEqual(MatteEngines.isAutomaticDefault(), false, 'legacy light mode is preserved');
storage.delete('vs_live_engine');
assert.strictEqual(MatteEngines.isAutomaticDefault(), true, 'removing the legacy override restores first-run Automatic');

const created = MatteEngines.createProvider('genesis-hybrid-tam');
assert.ok(created && created.wrapped instanceof VS.GenesisHybridProvider, 'the adaptive factory can construct UltraMatte for a background probe');
assert.strictEqual(MatteEngines.pref(), 'modnet', 'probing UltraMatte does not switch the active/default route');
assert.strictEqual(MatteEngines.validateProvider('genesis-hybrid-tam', { edgetam: { status: 'ready' } }), true,
  'UltraMatte is valid when its required EdgeTAM runtime is ready');
assert.throws(() => MatteEngines.validateProvider('genesis-hybrid-tam', { edgetam: { status: 'failed', error: 'offline' } }),
  /requires EdgeTAM.*offline/, 'an incomplete UltraMatte route cannot be promoted');
assert.throws(() => MatteEngines.validateProvider('edgetam', { edgetam: { status: 'idle' } }),
  /requires EdgeTAM/, 'explicit EdgeTAM selection is not reported ready before initialisation');
assert.strictEqual(MatteEngines.validateProvider('genesis-hybrid', { hy: {} }), true,
  'plain Hybrid does not require EdgeTAM');

MatteEngines.setPref('auto');
assert.strictEqual(MatteEngines.pref(), 'modnet', 'explicit Automatic retains the safe startup provider');
assert.strictEqual(MatteEngines.isAutomaticDefault(), true, 'Automatic re-enables adaptive probes');
assert.strictEqual(storage.get('vs_live_engine'), 'auto', 'Automatic clears an obsolete legacy live-engine override');
storage.set('vs_live_engine', 'rvm');
MatteEngines.setPref('ppmatting-v2');
assert.strictEqual(MatteEngines.pref(), 'ppmatting-v2', 'a newer explicit engine choice takes priority over an older RVM preference');
assert.strictEqual(storage.get('vs_live_engine'), 'auto', 'new engine choices clear stale legacy live-engine overrides');
assert.strictEqual(MatteEngines.isAutomaticDefault(), false, 'new explicit engine choice remains non-automatic');
MatteEngines.setPref('modnet');
assert.strictEqual(MatteEngines.isAutomaticDefault(), false, 'an explicit model disables the automatic probe sequence');
MatteEngines.setPref('auto');

VS.Flags = { get(key) { return key === 'ppmattingBeta' ? 0 : 0; } };
storage.delete('vs_matte_engine');
assert.strictEqual(MatteEngines.defaultEngine(), 'modnet', 'the remote safety kill switch never promotes experimental models');

console.log('matte-engines-default: all assertions passed');
