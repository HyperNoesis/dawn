// Temporal proxy on REAL people: each real portrait (with human GT alpha) is turned into a 24-frame clip by smooth camera-like motion
// (pan, zoom, small rotation, sensor noise), the SAME warp is applied to RGB and GT alpha, and the shipped providers run frame by frame in sequence.
// Measures per-frame alpha error and temporal instability (flicker = mean |d(pred) - d(gt)| between consecutive frames) and mask lag (frames).
// NOT real video: no motion blur, no real hair movement. Usage: REAL_GT=/tmp/realgt node tools/e2e/t64_real_motion_bench.js [engines=...] [--cpu=N]
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PW_LIB || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), DATA = path.resolve(process.env.REAL_GT || '/tmp/realgt');
const engines = (process.argv.find((a) => a.startsWith('engines=')) || 'engines=modnet,ppmatting-v2,genesis-hybrid,genesis-hybrid-tam').slice(8).split(',');
const cpu = Number((process.argv.find((a) => a.startsWith('--cpu=')) || '--cpu=1').slice(6));
const CLIPS = (process.env.CLIPS || 'p_07141906,p_514ca06a,p_818e689d,p_bd6af989').split(','), N = Number(process.env.FRAMES || 24);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mjs': 'text/javascript' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = p.startsWith('/__data/') ? path.join(DATA, p.slice(8)) : path.join(ROOT, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }); fs.createReadStream(f).pipe(r); });
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const summary = {};
  for (const eng of engines) {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, serviceWorkers: 'block' });
    await ctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'T', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); });
    const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 160)));
    if (cpu > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
    await page.goto(base + '/studio.html'); await page.waitForTimeout(2500);
    const r = await page.evaluate(async ({ eng, CLIPS, N }) => {
      const V = window.VS, load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(u)); i.src = u; });
      if (eng !== 'modnet') { const el = await V.MatteEngines.ensureEngine(eng); if (!el || !el.ok) throw new Error('deps ' + (el && el.error)); await V.loadOrt(); }
      const provider = V.MatteEngines.createProvider(eng); await provider.initialize(eng === 'modnet' ? 'balanced' : 'fast', { threads: 1 });
      const W = 960; let seed = 777; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const gray = (cv) => { const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data, o = new Uint8Array(cv.width * cv.height); for (let i = 0; i < o.length; i++) o[i] = d[i * 4]; return o; };
      const clips = [];
      for (const id of CLIPS) {
        const rgb = await load('/__data/frames/' + id + '.jpg'), gt = await load('/__data/gt/' + id + '.png');
        const w = W, h = Math.round(W * rgb.naturalHeight / rgb.naturalWidth);
        if (provider.resetTemporal) provider.resetTemporal();
        const preds = [], gts = [], ms = [];
        for (let f = 0; f < N; f++) {
          const t = f / (N - 1), zoom = 1.0 + 0.08 * Math.sin(Math.PI * t), dx = w * 0.05 * Math.sin(2 * Math.PI * t), dy = h * 0.03 * Math.sin(3 * Math.PI * t), rot = 0.035 * Math.sin(2 * Math.PI * t);
          const mk = (img, noise) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.translate(w / 2 + dx, h / 2 + dy); x.rotate(rot); x.scale(zoom, zoom); x.drawImage(img, -w / 2, -h / 2, w, h);
            if (noise) { const im = x.getImageData(0, 0, w, h); x.setTransform(1, 0, 0, 1, 0, 0); const d = im.data; for (let k = 0; k < d.length; k += 4) { const n = (rnd() + rnd() - 1) * 10; d[k] += n; d[k + 1] += n; d[k + 2] += n; } x.putImageData(im, 0, 0); } return c; };
          const frame = mk(rgb, true), g = mk(gt, false);
          Object.defineProperties(frame, { videoWidth: { value: w }, videoHeight: { value: h }, __vsSegmentationFrame: { value: true } });
          const s = performance.now(); const out = await provider.segment(frame); ms.push(performance.now() - s);
          const o = document.createElement('canvas'); o.width = w; o.height = h; const ox = o.getContext('2d', { willReadFrequently: true }); ox.drawImage(out.segmentationMask, 0, 0, w, h);
          const px = ox.getImageData(0, 0, w, h), d = px.data; let aVar = 0; for (let k = 3; k < d.length; k += 4 * 97) if (d[k] !== 255) aVar++;
          const p = new Uint8Array(w * h); for (let k = 0; k < p.length; k++) p[k] = aVar ? d[k * 4 + 3] : d[k * 4];
          preds.push(p); gts.push(gray(g));
        }
        // metrics in-browser (no PNG round trip): mae per frame, flicker, empty-frame count, lag in frames
        let mae = [], flick = [], empty = 0, gtMotion = [];
        for (let f = 0; f < N; f++) { let s = 0, fg = 0; for (let k = 0; k < preds[f].length; k++) { s += Math.abs(preds[f][k] - gts[f][k]); if (preds[f][k] > 127) fg++; } mae.push(s / preds[f].length / 255); if (fg < 0.002 * preds[f].length) empty++; }
        for (let f = 1; f < N; f++) { let s = 0, m = 0; for (let k = 0; k < preds[f].length; k++) { s += Math.abs((preds[f][k] - preds[f - 1][k]) - (gts[f][k] - gts[f - 1][k])); m += Math.abs(gts[f][k] - gts[f - 1][k]); } flick.push(s / preds[f].length / 255); gtMotion.push(m / preds[f].length / 255); }
        // lag: shift in frames at which pred best matches GT of an earlier frame
        let bestLag = 0, bestErr = 1e9; for (let lag = 0; lag <= 3; lag++) { let e = 0, c = 0; for (let f = lag; f < N; f++) { let s = 0; for (let k = 0; k < preds[f].length; k += 7) s += Math.abs(preds[f][k] - gts[f - lag][k]); e += s; c++; } if (e / c < bestErr) { bestErr = e / c; bestLag = lag; } }
        const q = (a, p2) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p2 * a.length))];
        clips.push({ id, mae_x1000: +(mae.reduce((a, b) => a + b, 0) / N * 1000).toFixed(2), worst_frame_mae_x1000: +(Math.max(...mae) * 1000).toFixed(1), flicker_x1000: +(flick.reduce((a, b) => a + b, 0) / flick.length * 1000).toFixed(2), gt_motion_x1000: +(gtMotion.reduce((a, b) => a + b, 0) / gtMotion.length * 1000).toFixed(2), empty_frames: empty, best_lag_frames: bestLag, ms_p50: Math.round(q(ms, .5)), ms_p95: Math.round(q(ms, .95)) });
      }
      return clips;
    }, { eng, CLIPS, N });
    summary[eng] = r; const mean = (k) => +(r.reduce((a, c) => a + c[k], 0) / r.length).toFixed(2);
    console.log(eng.padEnd(20), 'mae', mean('mae_x1000'), 'worstFrame', Math.max(...r.map((c) => c.worst_frame_mae_x1000)), 'flicker', mean('flicker_x1000'), '(gt motion', mean('gt_motion_x1000') + ')', 'empty', r.reduce((a, c) => a + c.empty_frames, 0), 'lag', r.map((c) => c.best_lag_frames).join('/'), 'ms p50', mean('ms_p50'), 'p95', Math.max(...r.map((c) => c.ms_p95)));
    await ctx.close();
  }
  fs.writeFileSync(path.join(DATA, 'motion_summary' + (cpu > 1 ? '_cpu' + cpu : '') + '.json'), JSON.stringify(summary, null, 1)); await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(2); });
