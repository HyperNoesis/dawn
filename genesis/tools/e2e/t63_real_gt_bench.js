// Real-image ground-truth benchmark through the SHIPPED browser providers (onnxruntime-web WASM, same code as Studio).
// Data (TEST ONLY, never shipped): 12 real portrait photos with human-annotated alpha (JizhiziLi/P3M demo, research/non-commercial licence).
// Each photo is scored clean and under photometric degradations of the RGB only (GT alpha unchanged): low light, sensor noise, defocus blur, low contrast.
// Usage: REAL_GT=/tmp/realgt node tools/e2e/t63_real_gt_bench.js [engines=comma list] [--cpu=N throttle]  -> $REAL_GT/pred/<engine>/<deg>/<id>.png + timings.json
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PW_LIB || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), DATA = path.resolve(process.env.REAL_GT || '/tmp/realgt');
const engines = (process.argv.find((a) => a.startsWith('engines=')) || 'engines=modnet,ppmatting-v2,genesis-hybrid,genesis-hybrid-tam').slice(8).split(',');
const cpu = Number((process.argv.find((a) => a.startsWith('--cpu=')) || '--cpu=1').slice(6));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mjs': 'text/javascript' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = p.startsWith('/__data/') ? path.join(DATA, p.slice(8)) : path.join(ROOT, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }); fs.createReadStream(f).pipe(r); });
const RESET = process.env.RESET_TEMPORAL === '1', OUT = process.env.PRED_DIR || 'pred';
const DEGS = ['clean', 'lowlight', 'noise', 'blur', 'lowcontrast'];
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const ids = fs.readdirSync(path.join(DATA, 'frames')).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)).sort();
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=4096'] });
  const timings = {};
  for (const eng of engines) {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, serviceWorkers: 'block' });
    await ctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'T', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); });
    const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 160)));
    if (cpu > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
    await page.goto(base + '/studio.html'); await page.waitForTimeout(2500);
    await page.exposeFunction('saveMask', (b64, deg, id) => { const d = path.join(DATA, OUT, eng, deg); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, id + '.png'), Buffer.from(b64, 'base64')); });
    const t = await page.evaluate(async ({ eng, ids, DEGS, RESET }) => {
      const V = window.VS, load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(u)); i.src = u; });
      if (eng !== 'modnet') { const el = await V.MatteEngines.ensureEngine(eng); if (!el || !el.ok) throw new Error('engine deps: ' + (el && el.error)); await V.loadOrt(); }
      const provider = V.MatteEngines.createProvider(eng); const t0 = performance.now();
      await provider.initialize(eng === 'modnet' ? 'balanced' : 'fast', { threads: 1 }); const initMs = performance.now() - t0;
      let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const ms = {}; for (const d of DEGS) ms[d] = [];
      for (const id of ids) {
        const img = await load('/__data/frames/' + id + '.jpg');
        for (const deg of DEGS) {
          const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d', { willReadFrequently: true });
          x.filter = deg === 'lowlight' ? 'brightness(0.28) contrast(0.9)' : deg === 'blur' ? 'blur(3px)' : deg === 'lowcontrast' ? 'contrast(0.45) brightness(1.1)' : 'none';
          x.drawImage(img, 0, 0); x.filter = 'none';
          if (deg === 'noise' || deg === 'lowlight') { const im = x.getImageData(0, 0, c.width, c.height), d = im.data, amp = deg === 'noise' ? 38 : 14; for (let k = 0; k < d.length; k += 4) { const n = (rnd() + rnd() + rnd() - 1.5) * amp; d[k] += n; d[k + 1] += n; d[k + 2] += n; } x.putImageData(im, 0, 0); }
          Object.defineProperties(c, { videoWidth: { value: c.width }, videoHeight: { value: c.height }, __vsSegmentationFrame: { value: true } });
          if (RESET && provider.resetTemporal) provider.resetTemporal();   // each photo is an independent clip: no tracker memory carried over
          const s = performance.now(); let out = await provider.segment(c);
          if (eng === 'genesis-hybrid-tam') out = await provider.segment(c);   // second call: EdgeTAM gate sees a prior frame like in live use
          ms[deg].push(performance.now() - s);
          const m = out.segmentationMask, o = document.createElement('canvas'); o.width = c.width; o.height = c.height; const ox = o.getContext('2d', { willReadFrequently: true }); ox.drawImage(m, 0, 0, c.width, c.height);
          const px = ox.getImageData(0, 0, c.width, c.height), d = px.data; let aVar = 0; for (let k = 3; k < d.length; k += 4 * 97) if (d[k] !== 255) aVar++;
          for (let k = 0; k < d.length; k += 4) { const a = aVar ? d[k + 3] : d[k]; d[k] = d[k + 1] = d[k + 2] = a; d[k + 3] = 255; }
          ox.putImageData(px, 0, 0); await window.saveMask(o.toDataURL('image/png').split(',')[1], deg, id);
        }
      }
      return { initMs, ms };
    }, { eng, ids, DEGS, RESET });
    const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    timings[eng] = { initMs: Math.round(t.initMs), cpuThrottle: cpu, perDegradationMs: Object.fromEntries(Object.entries(t.ms).map(([k, v]) => [k, { p50: Math.round(q(v, .5)), p95: Math.round(q(v, .95)), n: v.length }])) };
    console.log(eng, JSON.stringify(timings[eng]));
    await ctx.close();
  }
  fs.writeFileSync(path.join(DATA, 'timings.json'), JSON.stringify(timings, null, 1)); await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(2); });
