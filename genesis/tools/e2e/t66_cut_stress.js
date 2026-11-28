// Cut/switch stress on REAL portraits: frames are drawn from the 12 real photos in a fixed pseudo-random order, switching photo every K frames
// (K=1 is a hard cut every frame: worst case for any tracker or cached gate). Counts "dropped" frames = predicted foreground < 50% of the true foreground
// (the person vanishing), plus mean MAE. The provider is NOT reset between photos. Usage: REAL_GT=/tmp/realgt node tools/e2e/t66_cut_stress.js [engines=a,b] [K=1,3,8]
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PW_LIB || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), DATA = path.resolve(process.env.REAL_GT || '/tmp/realgt');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(k + '=')) || k + '=' + d).slice(k.length + 1);
const engines = arg('engines', 'genesis-hybrid-tam').split(','), Ks = arg('K', '1,3,8').split(',').map(Number), FR = Number(process.env.FRAMES || 36);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mjs': 'text/javascript' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = p.startsWith('/__data/') ? path.join(DATA, p.slice(8)) : path.join(ROOT, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }); fs.createReadStream(f).pipe(r); });
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const ids = fs.readdirSync(path.join(DATA, 'frames')).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)).sort();
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let bad = 0;
  for (const eng of engines) {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, serviceWorkers: 'block' });
    await ctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'T', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); });
    const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 160)));
    await page.goto(base + '/studio.html'); await page.waitForTimeout(2500);
    const out = await page.evaluate(async ({ eng, ids, Ks, FR }) => {
      const V = window.VS, load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(u)); i.src = u; });
      if (eng !== 'modnet') { const el = await V.MatteEngines.ensureEngine(eng); if (!el || !el.ok) throw new Error('deps'); await V.loadOrt(); }
      const provider = V.MatteEngines.createProvider(eng); await provider.initialize(eng === 'modnet' ? 'balanced' : 'fast', { threads: 1 });
      const imgs = {}, gts = {}; for (const id of ids) { imgs[id] = await load('/__data/frames/' + id + '.jpg'); gts[id] = await load('/__data/gt/' + id + '.png'); }
      const W = 640, gtGray = (img, h) => { const c = document.createElement('canvas'); c.width = W; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, h); const d = x.getImageData(0, 0, W, h).data, o = new Uint8Array(W * h); for (let i = 0; i < o.length; i++) o[i] = d[i * 4]; return o; };
      let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const res = {};
      for (const K of Ks) {
        let dropped = 0, n = 0, maeSum = 0, worst = 0, order = []; const events = [];
        for (let f = 0; f < FR; f++) { if (f % K === 0) order.push(ids[Math.floor(rnd() * ids.length)]); const id = order[order.length - 1]; const img = imgs[id], h = Math.round(W * img.naturalHeight / img.naturalWidth);
          const c = document.createElement('canvas'); c.width = W; c.height = h; c.getContext('2d').drawImage(img, 0, 0, W, h);
          Object.defineProperties(c, { videoWidth: { value: W }, videoHeight: { value: h }, __vsSegmentationFrame: { value: true } });
          const out = await provider.segment(c); const o = document.createElement('canvas'); o.width = W; o.height = h; const ox = o.getContext('2d', { willReadFrequently: true }); ox.drawImage(out.segmentationMask, 0, 0, W, h);
          const d = ox.getImageData(0, 0, W, h).data; let aVar = 0; for (let k = 3; k < d.length; k += 4 * 97) if (d[k] !== 255) aVar++;
          const g = gtGray(gts[id], h); let s = 0, pf = 0, gf = 0; for (let k = 0; k < g.length; k++) { const p = aVar ? d[k * 4 + 3] : d[k * 4]; s += Math.abs(p - g[k]); if (p > 127) pf++; if (g[k] > 127) gf++; }
          const mae = s / g.length / 255; maeSum += mae; n++; worst = Math.max(worst, mae); if (gf > 0.02 * g.length && pf < 0.5 * gf) { dropped++; events.push(f + ':' + id); } }
        res[K] = { frames: n, dropped, mae_x1000: +(maeSum / n * 1000).toFixed(1), worst_x1000: +(worst * 1000).toFixed(0), events: events.slice(0, 6), staleGateDrops: (provider.edgetam || {}).staleGateDrops };
      }
      return res;
    }, { eng, ids, Ks, FR });
    for (const K of Ks) { const r = out[K]; console.log(eng.padEnd(20), 'cut every', K, 'frame(s):', JSON.stringify(r)); if (r.dropped > 0) bad++; }
    await ctx.close();
  }
  await browser.close(); srv.close(); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
