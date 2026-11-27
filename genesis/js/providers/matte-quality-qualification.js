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
  // Qualification policy v1. These are explicit acceptance ceilings/floors,
  // not claimed measurements. Device latency remains a separate per-device gate.
  const QUALITY_LIMITS = Object.freeze({
    alphaMADMax: 0.05,
    edgeBandMADMax: 0.08,
    boundaryF1Min: 0.90,
    topologyErrorRateMax: 0.05,
    temporalDeltaMAEMax: 0.05
  });
  // Governance floors, not claims of universal statistical sufficiency. Every
  // difficult stratum must include distinct people, source videos and clips.
  const MIN_SAMPLE_COUNTS = Object.freeze({
    overall: Object.freeze({ participants:50, sourceVideos:100, clips:500, independentAnnotators:3 }),
    stratum: Object.freeze({ participants:10, sourceVideos:15, clips:30, independentAnnotators:2 })
  });
  const NO_REGRESSION_TOLERANCE = Object.freeze({
    alphaMAD:0.005, edgeBandMAD:0.01, boundaryF1:0.01,
    topologyErrorRate:0.01, temporalDeltaMAE:0.01
  });
  const MIN_MEASURABLE_IMPROVEMENT = Object.freeze({
    alphaMAD:0.005, edgeBandMAD:0.005, boundaryF1:0.01,
    topologyErrorRate:0.005, temporalDeltaMAE:0.005
  });
  function validQualityMetrics(values) {
    return !!values && STRATUM_METRIC_FIELDS.every((key)=>
      Number.isFinite(values[key]) && values[key]>=0 && values[key]<=1);
  }
  function noRegression(candidate, baseline) {
    if (!validQualityMetrics(candidate) || !validQualityMetrics(baseline)) return false;
    return candidate.alphaMAD <= baseline.alphaMAD + NO_REGRESSION_TOLERANCE.alphaMAD &&
      candidate.edgeBandMAD <= baseline.edgeBandMAD + NO_REGRESSION_TOLERANCE.edgeBandMAD &&
      candidate.boundaryF1 >= baseline.boundaryF1 - NO_REGRESSION_TOLERANCE.boundaryF1 &&
      candidate.topologyErrorRate <= baseline.topologyErrorRate + NO_REGRESSION_TOLERANCE.topologyErrorRate &&
      candidate.temporalDeltaMAE <= baseline.temporalDeltaMAE + NO_REGRESSION_TOLERANCE.temporalDeltaMAE;
  }
  function measurableImprovement(candidate, baseline) {
    if (!validQualityMetrics(candidate) || !validQualityMetrics(baseline)) return false;
    return baseline.alphaMAD - candidate.alphaMAD >= MIN_MEASURABLE_IMPROVEMENT.alphaMAD ||
      baseline.edgeBandMAD - candidate.edgeBandMAD >= MIN_MEASURABLE_IMPROVEMENT.edgeBandMAD ||
      candidate.boundaryF1 - baseline.boundaryF1 >= MIN_MEASURABLE_IMPROVEMENT.boundaryF1 ||
      baseline.topologyErrorRate - candidate.topologyErrorRate >= MIN_MEASURABLE_IMPROVEMENT.topologyErrorRate ||
      baseline.temporalDeltaMAE - candidate.temporalDeltaMAE >= MIN_MEASURABLE_IMPROVEMENT.temporalDeltaMAE;
  }
  function metricsPass(values) {
    return values.alphaMAD <= QUALITY_LIMITS.alphaMADMax &&
      values.edgeBandMAD <= QUALITY_LIMITS.edgeBandMADMax &&
      values.boundaryF1 >= QUALITY_LIMITS.boundaryF1Min &&
      values.topologyErrorRate <= QUALITY_LIMITS.topologyErrorRateMax &&
      values.temporalDeltaMAE <= QUALITY_LIMITS.temporalDeltaMAEMax;
  }
  const SHA256 = /^[a-f0-9]{64}$/i;
  const ROUTES = {
    'ppmatting-v2': { status:'unqualified', identity:null, evidence:null, reason:'No independently annotated, rights-cleared held-out human-video qualification report is registered for this exact model/runtime pipeline.' },
    'genesis-hybrid': { status:'unqualified', identity:null, evidence:null, reason:'Hybrid boundary-tile refinement has no independently annotated, rights-cleared held-out human-video qualification report for this exact pipeline.' },
    'genesis-hybrid-tam': { status:'unqualified', identity:null, evidence:null, reason:'UltraMatte (PP-MattingV2 + EdgeTAM + tile refinement) has no independently annotated, rights-cleared held-out human-video qualification report for this exact pipeline.' }
  };
  function blocked(code, reason) { return { eligible:false, code, reason }; }
  function positiveCount(value) { return Number.isSafeInteger(value) && value > 0; }
  function validIdentity(value) {
    if (!value || typeof value !== 'object') return false;
    for (const field of IDENTITY_FIELDS) if (typeof value[field] !== 'string' || !value[field].trim()) return false;
    return SHA256.test(value.modelSha256) && SHA256.test(value.preprocessHash) && SHA256.test(value.postprocessHash);
  }
  function sameIdentity(actual, expected) { return IDENTITY_FIELDS.every((field) => actual[field] === expected[field]); }
  function validEvidence(e) {
    if (!e || typeof e !== 'object') return false;
    const flags=['rightsClearedForCommercialUse','heldOut','participantAndSourceClipSplits','independentHumanAnnotation','annotationProtocolDocumented','interAnnotatorReviewCompleted','frameSynchronizationVerified','dimensionsAndAlphaEncodingVerified','annotationConfidenceRecorded','pairedBaselineComparison','perStratumResults','criticalStrataNoRegression','measurableImprovement'];
    if (!flags.every((key)=>e[key]===true)) return false;
    const evidenceHashes=['datasetManifestSha256','benchmarkReportSha256','annotationProtocolSha256','interAnnotatorReviewSha256','frameAlignmentManifestSha256','labelConfidenceManifestSha256','pairedClipResultsSha256'];
    if (!evidenceHashes.every((key)=>SHA256.test(e[key]||''))) return false;
    if (![e.participants,e.sourceVideos,e.clips,e.independentAnnotators,e.pairedClipCount].every(positiveCount)) return false;
    if (e.participants<MIN_SAMPLE_COUNTS.overall.participants ||
        e.sourceVideos<MIN_SAMPLE_COUNTS.overall.sourceVideos ||
        e.clips<MIN_SAMPLE_COUNTS.overall.clips ||
        e.independentAnnotators<MIN_SAMPLE_COUNTS.overall.independentAnnotators ||
        e.pairedClipCount!==e.clips ||
        e.pairedComparisonMethod!=='same-source-frames') return false;
    if (!validQualityMetrics(e.baselineMetrics) || !noRegression(e.metrics,e.baselineMetrics) ||
        !measurableImprovement(e.metrics,e.baselineMetrics)) return false;
    if (!Array.isArray(e.strata) || !e.strata.length) return false;
    const byId = new Map();
    for (const row of e.strata) {
      if (!row || typeof row.id !== 'string' || !row.id.trim() || byId.has(row.id)) return false;
      // A stratum name without its own labelled sample counts and scores
      // is not evidence. Counts are unique participants/source clips, not frames.
      if (![row.participants,row.sourceVideos,row.clips,row.independentAnnotators].every(positiveCount) ||
          row.participants<MIN_SAMPLE_COUNTS.stratum.participants ||
          row.sourceVideos<MIN_SAMPLE_COUNTS.stratum.sourceVideos ||
          row.clips<MIN_SAMPLE_COUNTS.stratum.clips ||
          row.independentAnnotators<MIN_SAMPLE_COUNTS.stratum.independentAnnotators) return false;
      if (row.participants>e.participants || row.sourceVideos>e.sourceVideos ||
          row.clips>e.clips || row.independentAnnotators>e.independentAnnotators) return false;
      const values = row.metrics;
      if (!validQualityMetrics(values) || !metricsPass(values) ||
          !noRegression(values,row.baselineMetrics)) return false;
      byId.set(row.id,row);
    }
    if (!REQUIRED_STRATA.every((id)=>byId.has(id))) return false;
    const m=e.metrics;
    if (!m || !METRIC_FIELDS.every((key)=>Number.isFinite(m[key]) && m[key]>=0)) return false;
    if (['alphaMAD','edgeBandMAD','boundaryF1','topologyErrorRate','temporalDeltaMAE'].some((key)=>m[key]>1)) return false;
    if (!metricsPass(m)) return false;
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
  const api={IDENTITY_FIELDS:IDENTITY_FIELDS.slice(),METRIC_FIELDS:METRIC_FIELDS.slice(),REQUIRED_STRATA:REQUIRED_STRATA.slice(),STRATUM_METRIC_FIELDS:STRATUM_METRIC_FIELDS.slice(),QUALITY_LIMITS,MIN_SAMPLE_COUNTS,NO_REGRESSION_TOLERANCE,MIN_MEASURABLE_IMPROVEMENT,ROUTES,validIdentity,validEvidence,noRegression,measurableImprovement,registered,evaluate,
    canAutoPromote(engine,identity,manifest){return evaluate(engine,identity,manifest).eligible;},automaticStatus};
  root.VS=root.VS||{}; root.VS.MatteQualityQualification=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
