'use strict';
const assert = require('assert');

global.window = global;
global.VS = {
  MODNetWorkerProvider: class MODNetWorkerProvider {
    static isSupported() { return true; }
  },
  MODNetSegmentationProvider: class MODNetSegmentationProvider {}
};
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

const created = MatteEngines.createProvider('genesis-hybrid-tam');
assert.ok(created && created.wrapped instanceof VS.GenesisHybridProvider, 'the adaptive factory can construct UltraMatte for a background probe');
assert.strictEqual(MatteEngines.pref(), 'modnet', 'probing UltraMatte does not switch the active/default route');

MatteEngines.setPref('auto');
assert.strictEqual(MatteEngines.pref(), 'modnet', 'explicit Automatic retains the safe startup provider');
assert.strictEqual(MatteEngines.isAutomaticDefault(), true, 'Automatic re-enables adaptive probes');
assert.strictEqual(storage.get('vs_live_engine'), 'auto', 'Automatic clears an obsolete legacy live-engine override');
MatteEngines.setPref('modnet');
assert.strictEqual(MatteEngines.isAutomaticDefault(), false, 'an explicit model disables the automatic probe sequence');
MatteEngines.setPref('auto');

VS.Flags = { get(key) { return key === 'ppmattingBeta' ? 0 : 0; } };
storage.delete('vs_matte_engine');
assert.strictEqual(MatteEngines.defaultEngine(), 'modnet', 'the remote safety kill switch never promotes experimental models');

console.log('matte-engines-default: all assertions passed');
