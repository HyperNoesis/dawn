'use strict';
const assert=require('assert');
const Q=require('../../js/providers/matte-quality-qualification.js');
for(const engine of ['ppmatting-v2','genesis-hybrid','genesis-hybrid-tam']){
 const d=Q.evaluate(engine,null);
 assert.strictEqual(d.eligible,false,engine+' must stay out of Automatic without independent qualification');
 assert.strictEqual(d.code,'QUALITY_NOT_QUALIFIED');
}
assert.strictEqual(Q.evaluate('not-an-engine',null).code,'UNKNOWN_ENGINE');
assert.strictEqual(Q.validIdentity(null),false);
const identity={modelVersion:'test-model-v1',modelSha256:'a'.repeat(64),preprocessHash:'b'.repeat(64),postprocessHash:'c'.repeat(64),runtimeBackend:'onnx-wasm'};
const approved={'genesis-hybrid':{status:'approved',identity:Object.assign({},identity),evidence:{
 rightsClearedForCommercialUse:true,heldOut:true,participantAndSourceClipSplits:true,independentHumanAnnotation:true,
 pairedBaselineComparison:true,perStratumResults:true,criticalStrataNoRegression:true,measurableImprovement:true,
 datasetManifestSha256:'d'.repeat(64),benchmarkReportSha256:'e'.repeat(64),participants:12,sourceVideos:24,clips:36,independentAnnotators:2,
 strata:Q.REQUIRED_STRATA.map((id)=>({id,participants:8,sourceVideos:12,clips:16,independentAnnotators:2,metrics:{alphaMAD:0.01,edgeBandMAD:0.02,boundaryF1:0.9,topologyErrorRate:0.01,temporalDeltaMAE:0.02}})),metrics:{alphaMAD:0.01,edgeBandMAD:0.02,boundaryF1:0.9,topologyErrorRate:0.01,temporalDeltaMAE:0.02,p95LatencyMs:85}
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
const impossibleCount=JSON.parse(JSON.stringify(approved));
impossibleCount['genesis-hybrid'].evidence.strata[0].participants=Infinity;
assert.strictEqual(Q.registered('genesis-hybrid',impossibleCount).code,'INCOMPLETE_QUALIFICATION_EVIDENCE',
  'sample counts must be finite positive integers, never Infinity or fractional estimates');
const automatic=Q.automaticStatus();assert.deepStrictEqual(automatic.eligible,[]);assert.strictEqual(automatic.blocked.length,3);
console.log('matte-quality-qualification: all assertions passed');
