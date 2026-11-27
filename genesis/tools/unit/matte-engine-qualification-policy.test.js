'use strict';
const assert = require('assert');
const Policy = require('../../js/providers/matte-engine-policy.js');

for (const engine of ['ppmatting-v2', 'genesis-hybrid', 'genesis-hybrid-tam']) {
  const spec = Policy.getSpec(engine);
  assert.ok(spec, engine + ' policy must exist');
  assert.ok(spec.scripts.includes('js/providers/matte-qualification-identity.js'),
    engine + ' must load the canonical identity implementation before provider construction');
  assert.ok(spec.requires.includes('MatteQualificationIdentity'),
    engine + ' must fail engine preparation if canonical identity is unavailable');
}
for (const engine of ['genesis-hybrid', 'genesis-hybrid-tam']) {
  const spec = Policy.getSpec(engine);
  assert.ok(spec.scripts.includes('js/providers/matte-critic.js'),
    engine + ' requires the critic source used by its boundary tile ranking');
  assert.ok(spec.requires.includes('MatteCritic'),
    engine + ' must fail preparation rather than silently omitting the critic');
}
assert.ok(Policy.getSpec('genesis-hybrid-tam').scripts.indexOf('js/providers/hybrid-provider.js') <
  Policy.getSpec('genesis-hybrid-tam').scripts.indexOf('js/providers/edgetam-provider.js'),
  'UltraMatte must install the Hybrid base provider before the EdgeTAM wrapper');
console.log('matte-engine-qualification-policy: all assertions passed');
