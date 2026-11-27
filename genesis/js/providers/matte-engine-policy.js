/* Pure routing policy for Genesis matting providers.
 * Keeping requirements per engine prevents one optional model from blocking every other model.
 */
(function (root) {
  'use strict';

  const SPECS = {
    modnet: {
      label: 'MODNet',
      scripts: [],
      requires: ['MODNetSegmentationProvider']
    },
    edgetam: {
      label: 'MODNet + EdgeTAM',
      scripts: ['js/providers/model-store.js', 'js/providers/edgetam-core.js', 'js/providers/edgetam-provider.js'],
      requires: ['ModelStore', 'EdgeTAMCore', 'EdgeTAMGate']
    },
    birefnet: {
      label: 'BiRefNet lite',
      scripts: ['js/providers/model-store.js', 'js/providers/temporal-mask.js', 'js/providers/edgetam-core.js', 'js/providers/birefnet-provider.js'],
      requires: ['ModelStore', 'TemporalMask', 'EdgeTAMCore', 'BiRefNetSegmentationProvider']
    },
    'ppmatting-v2': {
      label: 'PP-MattingV2',
      scripts: ['js/providers/matte-qualification-identity.js', 'js/providers/model-store.js', 'js/providers/ppmatting-core.js', 'js/providers/temporal-matte.js', 'js/providers/ppmatting-provider.js'],
      requires: ['MatteQualificationIdentity', 'ModelStore', 'PPMattingCore', 'TemporalMatte', 'PPMattingV2Provider']
    },
    'ppmatting-hrnet': {
      label: 'PP-Matting HRNet',
      scripts: ['js/providers/model-store.js', 'js/providers/ppmatting-core.js', 'js/providers/temporal-matte.js', 'js/providers/ppmatting-provider.js'],
      requires: ['ModelStore', 'PPMattingCore', 'TemporalMatte', 'PPMattingHRNetProvider']
    },
    'genesis-hybrid': {
      label: 'Genesis Hybrid',
      scripts: ['js/providers/matte-qualification-identity.js', 'js/providers/model-store.js', 'js/providers/ppmatting-core.js', 'js/providers/temporal-matte.js', 'js/providers/ppmatting-provider.js', 'js/providers/band-refine-core.js', 'js/providers/matte-critic.js', 'js/providers/hybrid-provider.js'],
      requires: ['MatteQualificationIdentity', 'ModelStore', 'PPMattingCore', 'TemporalMatte', 'PPMattingV2Provider', 'BandRefineCore', 'MatteCritic', 'GenesisHybridProvider']
    },
    'genesis-hybrid-tam': {
      label: 'Genesis UltraMatte',
      scripts: ['js/providers/matte-qualification-identity.js', 'js/providers/model-store.js', 'js/providers/ppmatting-core.js', 'js/providers/temporal-matte.js', 'js/providers/ppmatting-provider.js', 'js/providers/band-refine-core.js', 'js/providers/matte-critic.js', 'js/providers/hybrid-provider.js', 'js/providers/edgetam-core.js', 'js/providers/edgetam-provider.js'],
      requires: ['MatteQualificationIdentity', 'ModelStore', 'PPMattingCore', 'TemporalMatte', 'PPMattingV2Provider', 'BandRefineCore', 'MatteCritic', 'GenesisHybridProvider', 'EdgeTAMCore', 'EdgeTAMGate']
    }
  };

  function getSpec(engine) { return SPECS[engine] || null; }

  function resolve(engine, registry) {
    const spec = getSpec(engine);
    if (!spec) return { ok: false, engine, label: engine || 'Unknown engine', missing: ['Unknown engine selection'], scripts: [] };
    const scope = registry || {};
    const missing = spec.requires.filter((key) => !scope[key]);
    return { ok: missing.length === 0, engine, label: spec.label, missing, scripts: spec.scripts.slice() };
  }

  function scriptsFor(engine) {
    const spec = getSpec(engine);
    return spec ? spec.scripts.slice() : [];
  }

  // Saved governor rungs describe past device performance, not image-quality
  // evidence. Automatic experimental routes must retain their exact qualified
  // resolution; the established MODNet baseline and explicit BETA routes may
  // restore a prior performance rung.
  function canRestoreSavedGovernorRung(engine, automatic) {
    return !(automatic && engine !== 'modnet');
  }

  // Cross-engine promotions always need a registered identity. An automatic
  // same-engine restart also needs one because a fresh initialization may pick
  // a different backend/runtime than the provider that originally qualified.
  function requiresRuntimeQualification(engine, previousEngine, automatic) {
    if (engine === 'modnet' || engine === 'mediapipe') return false;
    return engine !== previousEngine || !!automatic;
  }

  const api = { SPECS, getSpec, resolve, scriptsFor, canRestoreSavedGovernorRung, requiresRuntimeQualification };
  root.VS = root.VS || {};
  root.VS.MatteEnginePolicy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
