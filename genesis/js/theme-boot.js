/* Applies the saved (or Atelier default) appearance before first paint, so no page ever flashes the old navy/violet look. Same schema as genesis-design.js. */
(function(){try{var d={mode:'system',accent:'champagne',style:'atelier',density:'creator'},s={};try{s=JSON.parse(localStorage.getItem('genesis.appearance.v1')||'{}')||{}}catch(e){}
var m=s.mode||d.mode,dark=m==='system'?!!(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches):m==='dark',r=document.documentElement;
r.dataset.theme=dark?'dark':'light';r.dataset.accent=s.accent||d.accent;r.dataset.style=s.style||d.style;r.dataset.density=s.density||d.density;r.style.colorScheme=dark?'dark':'light';}catch(e){}})();
