import sys
p=sys.argv[1]+'/js/app.js';s=open(p).read()
o="function writeBench(b) { try { localStorage.setItem("
n="function writeBench(b) { try { if (typeof batteryRef !== 'undefined' && batteryRef && batteryRef.level < 0.2) return; } catch (e0) {} try { localStorage.setItem("
if o in s and n not in s: open(p,'w').write(s.replace(o,n,1)); print('patched')
else: print('already/absent')
