'use strict';
const assert = require('assert');
const C = require('../../js/providers/ppmatting-core.js');

assert.deepStrictEqual(C.validateAlphaOutput(new Float32Array([0, 0.15, 0.5, 0.85, 1]), 5).ok, true);
assert.deepStrictEqual(C.validateAlphaOutput(new Float32Array([0, 0.5]), 3).ok, false);
assert.match(C.validateAlphaOutput(new Float32Array([0, NaN, 1]), 3).reason, /non-finite/);
assert.match(C.validateAlphaOutput(new Float32Array([0, Infinity, 1]), 3).reason, /non-finite/);
assert.match(C.validateAlphaOutput(new Float32Array([-0.1, 0.5, 1]), 3).reason, /outside/);
assert.match(C.validateAlphaOutput(new Float32Array([0, 0.5, 1.2]), 3).reason, /outside/);
assert.strictEqual(C.validateAlphaOutput(new Float32Array([-0.01, 0.5, 1.01]), 3).ok, true,
  'small floating-point overshoot is tolerated before the final clamp');

const alpha = C.toAlpha(new Float32Array([0, 0.5, 1]), 3);
assert.deepStrictEqual(Array.from(alpha), [0, 128, 255]);
console.log('ppmatting-core: all assertions passed');
