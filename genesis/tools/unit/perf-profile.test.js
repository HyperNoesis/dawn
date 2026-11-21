'use strict';
const assert = require('assert');
const PerfProfile = require('../../js/providers/perf-profile.js').VS.PerfProfile;

assert.strictEqual(PerfProfile.measuredFrameMs([]), 0, 'empty timing set has no measurement');
assert.strictEqual(PerfProfile.measuredFrameMs([210, 1210]), 710, 'two early-aborted samples use their median, not the lucky minimum');
assert.strictEqual(PerfProfile.measuredFrameMs([90, 160, 410]), 160, 'three samples use the median');
assert.strictEqual(PerfProfile.measuredFrameMs([80, 100, 130, 200]), 115, 'four samples use the midpoint median');
assert.strictEqual(PerfProfile.measuredFrameMs([100, 120, 140, 160, 500]), 120, 'five or more samples use the lower quartile');
assert.strictEqual(PerfProfile.measuredFrameMs([NaN, -1, 50, 100, Infinity]), 75, 'invalid timings are excluded from the sample');
assert.strictEqual(PerfProfile.detect({ hardwareConcurrency: 4 }).tier, 'low', 'a low-core desktop is not treated as a high-performance device');
assert.strictEqual(PerfProfile.detect({ hardwareConcurrency: 8, deviceMemory: 8 }).tier, 'standard', 'a capable desktop may start quality-first');

console.log('perf-profile: measured frame timing assertions passed');
