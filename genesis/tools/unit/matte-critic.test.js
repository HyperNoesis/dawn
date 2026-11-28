'use strict';
const assert=require('assert'),M=require('../../js/providers/matte-critic.js');
const w=64,h=48,a=new Uint8Array(w*h);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const d=Math.hypot(x-30,y-23);a[y*w+x]=Math.round(255*Math.max(0,Math.min(1,(15-d)/3+0.5)));}
const flat=new Uint8Array(16*12).fill(120),texture=new Uint8Array(16*12);
for(let y=0;y<12;y++)for(let x=0;x<16;x++)texture[y*16+x]=((x+y)%2)?230:20;
const base=M.analyse(a,w,h),f=M.analyse(a,w,h,{luma:flat,lumaWidth:16,lumaHeight:12}),t=M.analyse(a,w,h,{luma:texture,lumaWidth:16,lumaHeight:12});
assert.strictEqual(base.priority.length,w*h);assert.ok(base.stats.boundaryPixelPct>0&&base.stats.softPixelPct>0);
assert.ok(base.priority[23*w+30]<30&&base.priority[0]<30);assert.ok(base.priority[23*w+45]>base.priority[23*w+30]);
assert.ok(t.stats.detailDemandPct>f.stats.detailDemandPct);
const band=new Uint8Array(w*h);for(let y=8;y<40;y++){for(let x=0;x<24;x++)band[y*w+x]=1;for(let x=40;x<64;x++)band[y*w+x]=1;}
const tiles=[{x:0,y:0,w:24,h:48,count:100,score:100,key:'flat'},{x:40,y:0,w:24,h:48,count:100,score:100,key:'texture'}],p=new Uint8Array(w*h);
for(let y=8;y<40;y++)for(let x=40;x<64;x++)p[y*w+x]=240;
const ranked=M.rankTiles(tiles,p,w,h,band);assert.strictEqual(ranked[0].key,'texture');assert.ok(ranked[0].criticPriority>ranked[1].criticPriority);
assert.ok(M.analyse(new Uint8Array(w*h),w,h).stats.riskFlags.includes('empty_or_full_mask'));
assert.ok(M.analyse(new Uint8Array(w*h).fill(255),w,h).stats.riskFlags.includes('empty_or_full_mask'));
const bad=new Float32Array(w*h);bad.fill(0.5);bad[0]=NaN;assert.ok(M.analyse(bad,w,h).stats.invalidAlphaPct>0);
assert.ok(M.analyse(bad,w,h).stats.riskFlags.includes('invalid_alpha_values'));
console.log('matte-critic: heuristic prioritisation and risk-stat tests passed');
