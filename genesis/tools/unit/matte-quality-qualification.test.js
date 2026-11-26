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
 strata:['hair','hands','occlusion'],metrics:{alphaMAD:0.01,edgeBandMAD:0.02,boundaryF1:0.9,topologyErrorRate:0.01,temporalDeltaMAE:0.02,p95LatencyMs:85}
}}};
assert.strictEqual(Q.evaluate('genesis-hybrid',identity,approved).eligible,true,'a complete exact-version qualification can be approved');
assert.strictEqual(Q.evaluate('genesis-hybrid',Object.assign({},identity,{postprocessHash:'f'.repeat(64)}),approved).code,'QUALIFICATION_IDENTITY_MISMATCH');
const incomplete=JSON.parse(JSON.stringify(approved));delete incomplete['genesis-hybrid'].evidence.participantAndSourceClipSplits;
assert.strictEqual(Q.evaluate('genesis-hybrid',identity,incomplete).code,'INCOMPLETE_QUALIFICATION_EVIDENCE');
const automatic=Q.automaticStatus();assert.deepStrictEqual(automatic.eligible,[]);assert.strictEqual(automatic.blocked.length,3);
console.log('matte-quality-qualification: all assertions passed');
