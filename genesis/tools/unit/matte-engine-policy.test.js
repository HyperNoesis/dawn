const assert = require('assert');
const P = require('../../js/providers/matte-engine-policy.js');

const ppmattingReady = {
  MatteQualificationIdentity: true,
  ModelStore: true,
  PPMattingCore: true,
  TemporalMatte: true,
  PPMattingV2Provider: true
};

// PP-MattingV2 must not depend on unrelated BiRefNet or EdgeTAM modules.
assert.strictEqual(P.resolve('ppmatting-v2', ppmattingReady).ok, true);
assert.strictEqual(P.resolve('ppmatting-v2', Object.assign({}, ppmattingReady, { BiRefNetSegmentationProvider: false })).ok, true);
assert.strictEqual(P.resolve('ppmatting-v2', Object.assign({}, ppmattingReady, { EdgeTAMGate: false })).ok, true);

// Hybrid requires only the PP-Matting and boundary-refinement stack.
const hybridReady = Object.assign({}, ppmattingReady, {
  MatteCritic: true,
  BandRefineCore: true,
  GenesisHybridProvider: true
});
assert.strictEqual(P.resolve('genesis-hybrid', hybridReady).ok, true);
assert.strictEqual(P.resolve('genesis-hybrid', Object.assign({}, hybridReady, { EdgeTAMGate: false })).ok, true);

// UltraMatte-with-tracking explicitly requires EdgeTAM; missing dependencies are named.
const ultra = P.resolve('genesis-hybrid-tam', hybridReady);
assert.strictEqual(ultra.ok, false);
assert(ultra.missing.includes('EdgeTAMCore'));
assert(ultra.missing.includes('EdgeTAMGate'));
assert.strictEqual(P.resolve('genesis-hybrid-tam', Object.assign({}, hybridReady, {
  EdgeTAMCore: true, EdgeTAMGate: true
})).ok, true);

// Each spec returns its own script list; optional models never appear in another engine's list.
assert(P.scriptsFor('ppmatting-v2').includes('js/providers/ppmatting-provider.js'));
assert(!P.scriptsFor('ppmatting-v2').includes('js/providers/birefnet-provider.js'));
assert(!P.scriptsFor('ppmatting-v2').includes('js/providers/edgetam-provider.js'));
assert.strictEqual(P.resolve('not-an-engine', {}).ok, false);

// A remembered performance rung is not evidence for a changed experimental
// pipeline. Automatic experimental routes stay on the exact qualified size;
// explicit BETA selections and the established MODNet baseline may adapt.
assert.strictEqual(P.canRestoreSavedGovernorRung('genesis-hybrid-tam', true), false);
assert.strictEqual(P.canRestoreSavedGovernorRung('genesis-hybrid', true), false);
assert.strictEqual(P.canRestoreSavedGovernorRung('ppmatting-v2', true), false);
assert.strictEqual(P.canRestoreSavedGovernorRung('modnet', true), true);
assert.strictEqual(P.canRestoreSavedGovernorRung('genesis-hybrid-tam', false), true);
assert.strictEqual(P.requiresRuntimeQualification('genesis-hybrid-tam', 'genesis-hybrid-tam', true), true,
  'automatic same-engine restarts must revalidate the exact runtime identity');
assert.strictEqual(P.requiresRuntimeQualification('genesis-hybrid-tam', 'genesis-hybrid-tam', false), false,
  'explicit BETA same-engine restarts remain user-directed');
assert.strictEqual(P.requiresRuntimeQualification('genesis-hybrid', 'genesis-hybrid-tam', false), true,
  'cross-engine transitions always require an exact identity check');
assert.strictEqual(P.requiresRuntimeQualification('modnet', 'genesis-hybrid-tam', true), false,
  'the established MODNet baseline is not an experimental qualification route');
console.log('matte-engine-policy: all assertions passed');
