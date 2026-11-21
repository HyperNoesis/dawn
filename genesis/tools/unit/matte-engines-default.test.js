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

assert.strictEqual(MatteEngines.defaultEngine(), 'genesis-hybrid-tam', 'the first-run default is the advanced UltraMatte route');
assert.strictEqual(MatteEngines.pref(), 'genesis-hybrid-tam', 'no saved choice resolves to the advanced default');
assert.strictEqual(MatteEngines.isAutomaticDefault(), true, 'a first-run default remains distinguishable from an explicit user choice');

const created = MatteEngines.createProvider('genesis-hybrid-tam');
assert.ok(created && created.wrapped instanceof VS.GenesisHybridProvider, 'UltraMatte factory wraps the Hybrid provider with EdgeTAM');
assert.strictEqual(MatteEngines.pref(), 'genesis-hybrid-tam', 'creating a fallback candidate does not mutate the saved preference');

MatteEngines.setPref('modnet');
assert.strictEqual(MatteEngines.pref(), 'modnet', 'an explicit user choice is retained');
assert.strictEqual(MatteEngines.isAutomaticDefault(), false, 'an explicit choice disables automatic first-run fallback ordering');

VS.Flags = { get(key) { return key === 'ppmattingBeta' ? 0 : 0; } };
storage.delete('vs_matte_engine');
assert.strictEqual(MatteEngines.defaultEngine(), 'modnet', 'the remote safety kill switch disables experimental defaults');

console.log('matte-engines-default: all assertions passed');
