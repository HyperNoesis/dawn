'use strict';
const assert = require('assert');
require('../../js/providers/gl-matte.js');
const resolve = globalThis.VS && globalThis.VS.GLMatte && globalThis.VS.GLMatte.resolveEdgeThresholds;
assert.strictEqual(typeof resolve, 'function', 'GLMatte must expose its deterministic edge-threshold profile resolver');

const lowLandscape = resolve(256, 144, 0.30, 0.70, 'auto');
assert.deepStrictEqual(lowLandscape, { edgeLo:0.30, edgeHi:0.70, profile:'legacy-fixed' },
  'legacy 256px masks keep the established edge thresholds');
const lowPortrait = resolve(384, 256, 0.30, 0.70, 'auto');
assert.deepStrictEqual(lowPortrait, { edgeLo:0.30, edgeHi:0.70, profile:'legacy-fixed' },
  'coarse masks below 448px keep the established edge thresholds');

const highLandscape = resolve(512, 384, 0.30, 0.70, 'auto');
assert.deepStrictEqual(highLandscape, {
  edgeLo:0.175, edgeHi:0.825, profile:'high-resolution-alpha-preserving', crisp:0.5
}, 'high-resolution mask uses the calibrated alpha-preserving profile');

const highPortrait = resolve(384, 512, 0.30, 0.70, 'auto');
assert.deepStrictEqual(highPortrait, highLandscape,
  'profile selection uses the longest mask edge, including portrait frames');

const soft = resolve(512, 384, 0.15, 0.85, 'auto');
assert.strictEqual(soft.edgeLo, 0.05);
assert.strictEqual(soft.edgeHi, 0.95);
assert.strictEqual(soft.crisp, 0);

const crisp = resolve(512, 384, 0.45, 0.55, 'auto');
assert.strictEqual(crisp.edgeLo, 0.30);
assert.strictEqual(crisp.edgeHi, 0.70);
assert.strictEqual(crisp.crisp, 1);

const explicit = resolve(512, 384, 0.05, 0.95, 'fixed');
assert.deepStrictEqual(explicit, { edgeLo:0.05, edgeHi:0.95, profile:'legacy-fixed' },
  'explicit A/B configurations bypass automatic profile mapping');

console.log('gl-matte-profile: all assertions passed');
