'use strict';
const assert = require('assert');
const PerfProfile = require('../../js/providers/perf-profile.js').VS.PerfProfile;

assert.strictEqual(PerfProfile.measuredFrameMs([]), 0, 'empty timing set has no measurement');
assert.strictEqual(PerfProfile.measuredFrameMs([210, 1210]), 710, 'two early-aborted samples use their median');
assert.strictEqual(PerfProfile.measuredFrameMs([90, 160, 410]), 160, 'three samples use the median');
assert.strictEqual(PerfProfile.measuredFrameMs([80, 100, 130, 200]), 115, 'four samples use the midpoint median');
assert.strictEqual(PerfProfile.measuredFrameMs([100, 120, 140, 160, 500]), 160, 'five samples use P75, not the optimistic lower quartile');
assert.strictEqual(PerfProfile.measuredFrameMs([10, 20, 30, 40, 50, 60, 70, 80]), 60, 'eight samples use nearest-rank P75');
assert.strictEqual(PerfProfile.measuredFrameMs([NaN, -1, 50, 100, Infinity]), 75, 'invalid timings are excluded');
assert.strictEqual(PerfProfile.lowQuartile([10, 20, 30, 40, 50, 60, 70, 80]), 20, 'lower quartile remains available for diagnostics');
assert.strictEqual(PerfProfile.detect({ hardwareConcurrency: 4 }).tier, 'low', 'low-core desktop is constrained');
assert.strictEqual(PerfProfile.detect({ hardwareConcurrency: 8, deviceMemory: 8 }).tier, 'standard', 'capable desktop is standard');

console.log('perf-profile: conservative P75 timing assertions passed');
