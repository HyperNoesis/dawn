const assert = require('assert');
const Q = require('../../js/providers/engine-qualification.js');
const H = { 'ppmatting-v2': 'aa', edgetam: 'bb' };
const good = { kind: 'real-video-heldout', participants: 6, clips: 24, criticalRegression: false, preproc: 'v1', postproc: 'v1', weightsSha256: { 'ppmatting-v2': 'aa', edgetam: 'bb' } };

// nothing is approved without evidence; baseline always allowed
assert.strictEqual(Q.allowedForAuto('modnet').ok, true);
for (const k of ['ppmatting-v2', 'genesis-hybrid', 'genesis-hybrid-tam']) {
  const r = Q.allowedForAuto(k, { hashes: H });
  assert.strictEqual(r.ok, false, k + ' must not auto-promote without held-out real-video evidence');
  assert.strictEqual(r.status, 'experimental');
}
// explicit opt-in allows experimental, and is labelled as such
const opt = Q.allowedForAuto('genesis-hybrid-tam', { allowExperimental: true });
assert.strictEqual(opt.ok, true); assert.strictEqual(opt.status, 'experimental');
// valid evidence approves
assert.strictEqual(Q.evaluate('genesis-hybrid-tam', { 'genesis-hybrid-tam': good }, H).status, 'approved');
// invalidation: hash, preprocessing, size, kind, regression
const bad = (o) => Q.evaluate('genesis-hybrid-tam', { 'genesis-hybrid-tam': Object.assign({}, good, o) }, H);
assert.strictEqual(bad({ weightsSha256: { 'ppmatting-v2': 'aa', edgetam: 'zz' } }).status, 'experimental');
assert.strictEqual(bad({ preproc: 'v0' }).status, 'experimental');
assert.strictEqual(bad({ participants: 2 }).status, 'experimental');
assert.strictEqual(bad({ kind: 'synthetic' }).status, 'experimental');
assert.strictEqual(bad({ criticalRegression: true }).status, 'experimental');
assert.strictEqual(Q.evaluate('nope').status, 'unknown');
const f = Q.filterAuto(['genesis-hybrid-tam', 'genesis-hybrid', 'ppmatting-v2', 'modnet'], {});
assert.deepStrictEqual(f.allowed, ['modnet']); assert.strictEqual(f.skipped.length, 3);
console.log('engine-qualification: all assertions passed');
