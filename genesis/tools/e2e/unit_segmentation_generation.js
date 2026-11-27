'use strict';
const assert = require('assert');
const guard = require('../../js/providers/segmentation-generation.js');

const providerA = { id: 'provider-a' };
const providerB = { id: 'provider-b' };
const original = { provider: providerA, sessionToken: 41, providerGeneration: 8 };
const job = guard.stamp(original.provider, original.sessionToken, original.providerGeneration);

assert(Object.isFrozen(job), 'job identity must be immutable');
assert.strictEqual(guard.matches(job, original), true, 'the exact provider/session generation remains current');
assert.strictEqual(guard.matches(job, { ...original }), true, 'equivalent current identity matches');
assert.strictEqual(guard.matches(job, { ...original, provider: providerB }), false, 'provider replacement invalidates a pending result');
assert.strictEqual(guard.matches(job, { ...original, sessionToken: 42 }), false, 'camera stop/restart invalidates a pending result');
assert.strictEqual(guard.matches(job, { ...original, providerGeneration: 9 }), false, 'cache/provider reset invalidates a pending result');
assert.strictEqual(guard.matches(job, null), false, 'missing current state fails closed');
assert.strictEqual(guard.matches(null, original), false, 'missing job state fails closed');

console.log('segmentation-generation: all assertions passed');
