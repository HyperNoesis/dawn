/* Genesis segmentation quality qualification gate.
 * Performance chooses among routes already qualified for image quality; it does not establish quality.
 * The registry is deliberately fail-closed until exact-version, rights-cleared, held-out human-video
 * evidence is independently available. No synthetic or invented scores are stored here.
 */
(function (root) {
  'use strict';
  const IDENTITY_FIELDS = ['modelVersion','modelSha256','preprocessHash','postprocessHash','runtimeBackend'];
  const METRIC_FIELDS = ['alphaMAD','edgeBandMAD','boundaryF1','topologyErrorRate','temporalDeltaMAE','p95LatencyMs'];
  // Every quality stratum named in the execution brief must be represented by
  // independently labelled clips and separately reported metrics.
  const REQUIRED_STRATA = [
    'hair-straight','hair-wavy','hair-curly','hair-coily','flyaways','braids',
    'dark-light-hair-background','backlight','low-light','similar-colours',
    'glasses','headphones','hats-headwraps','hands-crossing-face','finger-gaps',
    'thin-straps','lace','transparent-fabric','textured-clothes','motion-blur',
    'partial-occlusion','multiple-people','scene-cuts'
  ];
  const STRATUM_METRIC_FIELDS = ['alphaMAD','edgeBandMAD','boundaryF1','topologyErrorRate','temporalDeltaMAE'];
  const SHA256 = /^[a-f0-9]{64}$/i;
  const ROUTES = {
    'ppmatting-v2': { status:'unqualified', identity:null, evidence:null, reason:'No independently annotated, rights-cleared held-out human-video qualification report is registered for this exact model/runtime pipeline.' },
    'genesis-hybrid': { status:'unqualified', identity:null, evidence:null, reason:'Hybrid boundary-tile refinement has no independently annotated, rights-cleared held-out human-video qualification report for this exact pipeline.' },
    'genesis-hybrid-tam': { status:'unqualified', identity:null, evidence:null, reason:'UltraMatte (PP-MattingV2 + EdgeTAM + tile refinement) has no independently annotated, rights-cleared held-out human-video qualification report for this exact pipeline.' }
  };
  function blocked(code, reason) { return { eligible:false, code, reason }; }
  function validIdentity(value) {
    if (!value || typeof value !== 'object') return false;
    for (const field of IDENTITY_FIELDS) if (typeof value[field] !== 'string' || !value[field].trim()) return false;
    return SHA256.test(value.modelSha256) && SHA256.test(value.preprocessHash) && SHA256.test(value.postprocessHash);
  }
  function sameIdentity(actual, expected) { return IDENTITY_FIELDS.every((field) => actual[field] === expected[field]); }
  function validEvidence(e) {
    if (!e || typeof e !== 'object') return false;
    const flags=['rightsClearedForCommercialUse','heldOut','participantAndSourceClipSplits','independentHumanAnnotation','pairedBaselineComparison','perStratumResults','criticalStrataNoRegression','measurableImprovement'];
    if (!flags.every((key)=>e[key]===true)) return false;
    if (!SHA256.test(e.datasetManifestSha256||'') || !SHA256.test(e.benchmarkReportSha256||'')) return false;
    if (!(e.participants>0) || !(e.sourceVideos>0) || !(e.clips>0) || !(e.independentAnnotators>0)) return false;
    if (!Array.isArray(e.strata) || !e.strata.length) return false;
    const byId = new Map();
    for (const row of e.strata) {
      if (!row || typeof row.id !== 'string' || !row.id.trim() || byId.has(row.id)) return false;
      const values = row.metrics;
      if (!values || !STRATUM_METRIC_FIELDS.every((key)=>Number.isFinite(values[key]) && values[key]>=0)) return false;
      if (values.boundaryF1>1 || values.topologyErrorRate>1) return false;
      byId.set(row.id,row);
    }
    if (!REQUIRED_STRATA.every((id)=>byId.has(id))) return false;
    const m=e.metrics;
    if (!m || !METRIC_FIELDS.every((key)=>Number.isFinite(m[key]) && m[key]>=0)) return false;
    if (m.boundaryF1>1 || m.topologyErrorRate>1) return false;
    return true;
  }
  function registered(engine, manifest) {
    const registry=manifest||ROUTES, entry=registry&&registry[engine];
    if (!entry) return blocked('UNKNOWN_ENGINE','No quality qualification record exists for this engine.');
    if (entry.status!=='approved') return blocked('QUALITY_NOT_QUALIFIED',entry.reason||'This engine has not passed the human-video quality qualification gate.');
    if (!validIdentity(entry.identity)) return blocked('INVALID_QUALIFICATION_IDENTITY','The registered qualification is missing a complete versioned pipeline identity.');
    if (!validEvidence(entry.evidence)) return blocked('INCOMPLETE_QUALIFICATION_EVIDENCE','The qualification record is missing rights, held-out split, independent annotation, per-stratum or metric evidence.');
    return {eligible:true,code:'REGISTERED_QUALIFICATION',identity:entry.identity,reason:'The exact pipeline has a complete registered qualification; the provider identity must still match at runtime.'};
  }
  function evaluate(engine, identity, manifest) {
    const registration=registered(engine,manifest);
    if (!registration.eligible) return registration;
    if (!validIdentity(identity)) return blocked('MISSING_RUNTIME_IDENTITY','The active provider has not supplied a complete model, preprocessing, postprocessing and runtime identity.');
    if (!sameIdentity(identity,registration.identity)) return blocked('QUALIFICATION_IDENTITY_MISMATCH','The installed model or processing/runtime version differs from the version that was evaluated.');
    return {eligible:true,code:'QUALIFIED',reason:'This exact model and processing/runtime version has a complete registered held-out quality qualification.',engine};
  }
  function automaticStatus(manifest) {
    const registry=manifest||ROUTES, eligible=[], blockedRoutes=[];
    Object.keys(registry).forEach((engine)=>{const d=registered(engine,registry);if(d.eligible)eligible.push(engine);else blockedRoutes.push({engine,code:d.code,reason:d.reason});});
    return {
      eligible, blocked:blockedRoutes,
      message:eligible.length
        ? 'Only independently quality-qualified routes may be considered for automatic promotion; device timing selects among those routes.'
        : 'Automatic mode is retaining the established local baseline. Experimental PP-MattingV2, Hybrid and UltraMatte routes remain available for explicit testing, but are not automatically promoted until their exact pipelines pass independent held-out human-video qualification.'
    };
  }
  const api={IDENTITY_FIELDS:IDENTITY_FIELDS.slice(),METRIC_FIELDS:METRIC_FIELDS.slice(),REQUIRED_STRATA:REQUIRED_STRATA.slice(),STRATUM_METRIC_FIELDS:STRATUM_METRIC_FIELDS.slice(),ROUTES,validIdentity,validEvidence,registered,evaluate,
    canAutoPromote(engine,identity,manifest){return evaluate(engine,identity,manifest).eligible;},automaticStatus};
  root.VS=root.VS||{}; root.VS.MatteQualityQualification=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
