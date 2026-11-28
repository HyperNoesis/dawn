/**
 * Genesis Matte Critic — deterministic boundary-detail demand estimator.
 * HEURISTIC only: not learned confidence or ground-truth quality.
 */
(function(root){
'use strict';
function clamp01(v){return Math.max(0,Math.min(1,v));}
function smoothstep(a,b,x){const t=clamp01((x-a)/Math.max(1e-6,b-a));return t*t*(3-2*t);}
function analyse(alpha,width,height,options){
 options=options||{};const w=width|0,h=height|0,n=w*h;
 if(!alpha||w<1||h<1||alpha.length!==n)throw new Error('MatteCritic requires alpha length to equal width × height');
 const luma=options.luma||null,lw=options.lumaWidth|0,lh=options.lumaHeight|0;
 const hasLuma=!!(luma&&lw>1&&lh>1&&luma.length>=lw*lh),priority=new Uint8Array(n),values=new Float32Array(n);
 let invalid=0,soft=0,boundary=0,textured=0,foreground=0,borderForeground=0,isolated=0,scale=1/255;
 if(alpha instanceof Float32Array||alpha instanceof Float64Array){let max=0;for(let i=0;i<n;i++)if(Number.isFinite(alpha[i])&&alpha[i]>max)max=alpha[i];if(max<=1.0001)scale=1;}
 for(let i=0;i<n;i++){const v=Number(alpha[i]);if(!Number.isFinite(v)||v< -0.01/scale||v>1.01/scale){invalid++;values[i]=0;}else values[i]=clamp01(v*scale);}
 const gridX=x=>Math.max(0,Math.min(lw-1,Math.floor((x+0.5)*lw/w)));
 const gridY=y=>Math.max(0,Math.min(lh-1,Math.floor((y+0.5)*lh/h)));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,a=values[i];if(a>0.5){foreground++;if(x===0||y===0||x===w-1||y===h-1)borderForeground++;}
  const r=x+1<w?values[i+1]:a,d=y+1<h?values[i+w]:a,l=x>0?values[i-1]:a,u=y>0?values[i-w]:a;
  const edge=Math.max((1-Math.abs(2*a-1))*0.8,clamp01(Math.max(Math.abs(r-a),Math.abs(d-a),Math.abs(a-l),Math.abs(a-u))*2.2));
  if(a>0.02&&a<0.98)soft++;if(edge>0.12)boundary++;
  let texture=0;if(hasLuma&&edge>0.08){
   // Compare adjacent native luma-grid cells. Wider source-space offsets can
   // alias alternating texture patterns and make thin strands look textureless.
   const sx=gridX(x),sy=gridY(y);
   const centre=Number(luma[sy*lw+sx])||0;
   const gx=Math.max(Math.abs((Number(luma[sy*lw+Math.min(lw-1,sx+1)])||0)-centre),Math.abs((Number(luma[sy*lw+Math.max(0,sx-1)])||0)-centre))/255;
   const gy=Math.max(Math.abs((Number(luma[Math.min(lh-1,sy+1)*lw+sx])||0)-centre),Math.abs((Number(luma[Math.max(0,sy-1)*lw+sx])||0)-centre))/255;
   texture=smoothstep(0.04,0.28,gx+gy);
  }
  if(edge>0.12&&texture>0.2)textured++;priority[i]=Math.round(255*clamp01(edge*(hasLuma?0.25+0.75*texture:1)));
 }
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(values[i]<=0.5)continue;let near=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&values[(y+dy)*w+x+dx]>0.5)near++;if(!near)isolated++;}
 const coverage=foreground/n*100,isolatedPct=foreground?isolated/foreground*100:0,borderPct=foreground?borderForeground/foreground*100:0,flags=[];
 if(coverage<0.1||coverage>99.9)flags.push('empty_or_full_mask');if(isolatedPct>0.5)flags.push('isolated_foreground_pixels');if(borderPct>12)flags.push('foreground_touches_frame');if(invalid)flags.push('invalid_alpha_values');
 let sum=0;for(let i=0;i<n;i++)sum+=priority[i]/255;
 return {priority,stats:{method:'heuristic_boundary_detail_demand_v1',calibratedConfidence:false,detailDemandPct:+(sum/n*100).toFixed(3),softPixelPct:+(soft/n*100).toFixed(3),boundaryPixelPct:+(boundary/n*100).toFixed(3),texturedBoundaryPct:+(textured/n*100).toFixed(3),foregroundCoveragePct:+coverage.toFixed(3),isolatedForegroundPct:+isolatedPct.toFixed(3),foregroundBorderPct:+borderPct.toFixed(3),invalidAlphaPct:+(invalid/n*100).toFixed(3),riskFlags:flags}};
}
function rankTiles(tiles,priority,width,height,band){
 if(!Array.isArray(tiles)||!priority||priority.length!==width*height||!band||band.length!==width*height)return tiles||[];
 return tiles.map((tile,index)=>{let sum=0,count=0;for(let y=0;y<tile.h;y++)for(let x=0;x<tile.w;x++){const i=(tile.y+y)*width+tile.x+x;if(band[i]){sum+=priority[i]/255;count++;}}
 const demand=count?sum/count:0;return Object.assign({},tile,{criticPriority:demand,score:(Number(tile.score)||Number(tile.count)||0)*(1+demand),_order:index});
 }).sort((a,b)=>b.score-a.score||b.criticPriority-a.criticPriority||(Number(b.count)||0)-(Number(a.count)||0)||a._order-b._order).map(({_order,...tile})=>tile);
}
const api={analyse,rankTiles,smoothstep};root.VS=root.VS||{};root.VS.MatteCritic=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
