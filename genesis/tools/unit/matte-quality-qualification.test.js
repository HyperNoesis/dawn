'use strict';
const assert=require('assert');
const Q=require('../../js/providers/matte-quality-qualification.js');
assert.deepStrictEqual(Q.QUALITY_LIMITS,{
 alphaMADMax:0.05,edgeBandMADMax:0.08,boundaryF1Min:0.90,
 topologyErrorRateMax:0.05,temporalDeltaMAEMax:0.05
},'the v1 numeric quality policy must remain explicit and regression-tested');
assert.deepStrictEqual(Q.MIN_SAMPLE_COUNTS,{
 overall:{participants:50,sourceVideos:100,clips:500,independentAnnotators:3},
 stratum:{participants:10,sourceVideos:15,clips:30,independentAnnotators:2}
},'the evidence gate must reject toy sample sizes');
assert.strictEqual(Q.noRegression(candidateMetrics,baselineMetrics),true);
assert.strictEqual(Q.measurableImprovement(candidateMetrics,baselineMetrics),true);
for(const engine of ['ppmatting-v2','genesis-hybrid','genesis-hybrid-tam']){
 const d=Q.evaluate(engine,null);
 assert.strictEqual(d.eligible,false,engine+' must stay out of Automatic without independent qualification');
 assert.strictEqual(d.code,'QUALITY_NOT_QUALIFIED');
}
assert.strictEqual(Q.evaluate('not-an-engine',null).code,'UNKNOWN_ENGINE');
assert.strictEqual(Q.validIdentity(null),false);
const identity={modelVersion:'test-model-v1',modelSha256:'a'.repeat(64),preprocessHash:'b'.repeat(64),postprocessHash:'c'.repeat(64),runtimeBackend:'onnx-wasm'};
const baselineMetrics={alphaMAD:0.02,edgeBandMAD:0.03,boundaryF1:0.88,topologyErrorRate:0.02,temporalDeltaMAE:0.03};
const candidateMetrics={alphaMAD:0.01,edgeBandMAD:0.02,boundaryF1:0.90,topologyErrorRate:0.01,temporalDeltaMAE:0.02};
const approved={'genesis-hybrid':{status:'approved',identity:Object.assign({},identity),evidence:{
 rightsClearedForCommercialUse:true,heldOut:true,participantAndSourceClipSplits:true,independentHumanAnnotation:true,
 annotationProtocolDocumented:true,interAnnotatorReviewCompleted:true,frameSynchronizationVerified:true,
 dimensionsAndAlphaEncodingVerified:true,annotationConfidenceRecorded:true,
 pairedBaselineComparison:true,perStratumResults:true,criticalStrataNoRegression:true,measurableImprovement:true,
 datasetManifestSha256:'d'.repeat(64),benchmarkReportSha256:'e'.repeat(64),
 annotationProtocolSha256:'1'.repeat(64),interAnnotatorReviewSha256:'2'.repeat(64),
 frameAlignmentManifestSha256:'3'.repeat(64),labelConfidenceManifestSha256:'4'.repeat(64),
 pairedClipResultsSha256:'5'.repeat(64),pairedComparisonMethod:'same-source-frames',pairedClipCount:500,
 participants:50,sourceVideos:100,clips:500,independentAnnotators:3,
 baselineMetrics:Object.assign({},baselineMetrics),
 strata:Q.REQUIRED_STRATA.map((id)=>({id,participants:10,sourceVideos:15,clips:30,independentAnnotators:2,
   baselineMetrics:Object.assign({},baselineMetrics),metrics:Object.assign({},candidateMetrics)})),
 metrics:Object.assign({p95LatencyMs:85},candidateMetrics)
}}};
assert.strictEqual(Q.registered('genesis-hybrid',approved).eligible,true,'a complete human-video record is registered before the provider is instantiated');
assert.strictEqual(Q.evaluate('genesis-hybrid',identity,approved).eligible,true,'the initialized provider must also match the exact qualified identity');
assert.strictEqual(Q.evaluate('genesis-hybrid',null,approved).code,'MISSING_RUNTIME_IDENTITY','an approved report alone does not certify an unknown runtime provider');
assert.strictEqual(Q.evaluate('genesis-hybrid',Object.assign({},identity,{postprocessHash:'f'.repeat(64)}),approved).code,'QUALIFICATION_IDENTITY_MISMATCH');
const incomplete=JSON.parse(JSON.stringify(approved));delete incomplete['genesis-hybrid'].evidence.participantAndSourceClipSplits;
assert.strictEqual(Q.evaluate('genesis-hybrid',identity,incomplete).code,'INCOMPLETE_QUALIFICATION_EVIDENCE');
const missingHairStratum=JSON.parse(JSON.stringify(approved));
missingHairStratum['genesis-hybrid'].evidence.strata=missingHairStratum['genesis-hybrid'].evidence.strata.filter((row)=>row.id!=='hair-coily');
assert.strictEqual(Q.registered('genesis-hybrid',missingHairStratum).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'approval requires separate evidence for every hair and difficult-scene stratum in the execution brief');
const noCounts=JSON.parse(JSON.stringify(approved));
delete noCounts['genesis-hybrid'].evidence.strata[0].clips;
assert.strictEqual(Q.registered('genesis-hybrid',noCounts).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'each stratum needs labelled participant, source-video, clip and annotator counts');
const oneAnnotator=JSON.parse(JSON.stringify(approved));
oneAnnotator['genesis-hybrid'].evidence.independentAnnotators=1;
assert.strictEqual(Q.registered('genesis-hybrid',oneAnnotator).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'qualification requires at least two independent annotators');
const impossibleCount=JSON.parse(JSON.stringify(approved));
impossibleCount['genesis-hybrid'].evidence.strata[0].participants=Infinity;
assert.strictEqual(Q.registered('genesis-hybrid',impossibleCount).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'sample counts must be finite positive integers, never Infinity or fractional estimates');
const impossibleMetric=JSON.parse(JSON.stringify(approved));
impossibleMetric['genesis-hybrid'].evidence.strata[0].metrics.alphaMAD=1.4;
assert.strictEqual(Q.registered('genesis-hybrid',impossibleMetric).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'normalized alpha/edge/topology/temporal metrics must remain within their defined 0–1 range');
const impossibleStratum=JSON.parse(JSON.stringify(approved));
impossibleStratum['genesis-hybrid'].evidence.strata[0].clips=999;
assert.strictEqual(Q.registered('genesis-hybrid',impossibleStratum).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'per-stratum sample counts cannot exceed the dataset-wide totals');
const belowQualityBar=JSON.parse(JSON.stringify(approved));
belowQualityBar['genesis-hybrid'].evidence.strata[0].metrics.alphaMAD=0.2;
assert.strictEqual(Q.registered('genesis-hybrid',belowQualityBar).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'complete metadata cannot approve a stratum whose alpha error exceeds the quality ceiling');
const edgeBandTooHigh=JSON.parse(JSON.stringify(approved));
edgeBandTooHigh['genesis-hybrid'].evidence.strata[0].metrics.edgeBandMAD=0.081;
assert.strictEqual(Q.registered('genesis-hybrid',edgeBandTooHigh).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'per-stratum edge-band error must meet the numeric ceiling');
const temporalTooHigh=JSON.parse(JSON.stringify(approved));
temporalTooHigh['genesis-hybrid'].evidence.strata[0].metrics.temporalDeltaMAE=0.051;
assert.strictEqual(Q.registered('genesis-hybrid',temporalTooHigh).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'per-stratum temporal instability must meet the numeric ceiling');
const poorBoundary=JSON.parse(JSON.stringify(approved));
poorBoundary['genesis-hybrid'].evidence.metrics.boundaryF1=0.4;
assert.strictEqual(Q.registered('genesis-hybrid',poorBoundary).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'aggregate boundary F1 must meet the explicit minimum');
const tooFewPeople=JSON.parse(JSON.stringify(approved));tooFewPeople['genesis-hybrid'].evidence.participants=49;
assert.strictEqual(Q.registered('genesis-hybrid',tooFewPeople).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'dataset-wide participant minimum is enforced');
const tooFewClips=JSON.parse(JSON.stringify(approved));tooFewClips['genesis-hybrid'].evidence.strata[0].clips=29;
assert.strictEqual(Q.registered('genesis-hybrid',tooFewClips).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'every stratum must meet its independent clip minimum');
const missingPairedResults=JSON.parse(JSON.stringify(approved));delete missingPairedResults['genesis-hybrid'].evidence.pairedClipResultsSha256;
assert.strictEqual(Q.registered('genesis-hybrid',missingPairedResults).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'a paired per-clip result artifact is required');
const unpaired=JSON.parse(JSON.stringify(approved));unpaired['genesis-hybrid'].evidence.pairedClipCount=499;
assert.strictEqual(Q.registered('genesis-hybrid',unpaired).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'every evaluated clip must have a same-source-frame paired baseline result');
const regressedStratum=JSON.parse(JSON.stringify(approved));
regressedStratum['genesis-hybrid'].evidence.strata[0].baselineMetrics.boundaryF1=0.95;
assert.strictEqual(Q.registered('genesis-hybrid',regressedStratum).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'an aggregate pass cannot hide a critical-stratum regression against baseline');
const noImprovement=JSON.parse(JSON.stringify(approved));
noImprovement['genesis-hybrid'].evidence.baselineMetrics=Object.assign({},candidateMetrics);
noImprovement['genesis-hybrid'].evidence.strata.forEach((row)=>{row.baselineMetrics=Object.assign({},row.metrics);});
assert.strictEqual(Q.registered('genesis-hybrid',noImprovement).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'a route must demonstrate a measurable aggregate improvement over the paired baseline');
const automatic=Q.automaticStatus();assert.deepStrictEqual(automatic.eligible,[]);assert.strictEqual(automatic.blocked.length,3);
console.log('matte-quality-qualification: all assertions passed');
