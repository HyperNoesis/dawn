// v0.94 gate: the opt-in PP-Matting HRNet engine inside the real "Enhance quality" export (real worker, real weights, real compositor, real WebCodecs encode).
// Compares it with the shipped MODNet engine on the SAME clip against the synthetic ground truth in fixtures/. Needs models/ppmatting_v1.onnx (node scripts/fetch-models.js --only ppmatting-hrnet).
// Honest limits: the clip is synthetic, CPU/WASM timings mean nothing for phones.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), FIX = path.join(__dirname, 'fixtures');
const { chromium } = require(process.env.PW_LIB || 'playwright');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.webm': 'video/webm', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const FPS = 8;
(async () => {
  if (!fs.existsSync(path.join(ROOT, 'models', 'ppmatting_v1.onnx'))) { console.log('SKIPPED: models/ppmatting_v1.onnx missing'); process.exit(0); }
  const srv = http.createServer((q, r) => { const p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'content-length': fs.statSync(f).size }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'T', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(base + '/studio.html'); await page.waitForFunction(() => window.VS && window.VS.Enhance && window.VS.EnhanceCore, null, { timeout: 60000 });
  let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
  const R = await page.evaluate(async ({ clipUrl, gtUrl, FPS }) => {
    const VS = window.VS, C = VS.EnhanceCore, out = {};
    out.offeredDefault = C.availableModels({ deviceMemory: 8 }).join(); out.offeredOptIn = C.availableModels({ deviceMemory: 8, ppmatting: true }).join();
    const raw = await (await fetch(clipUrl)).blob();
    const gtImg = await new Promise((y) => { const i = new Image(); i.onload = () => y(i); i.src = gtUrl; });
    const runOne = async (model) => { const t0 = performance.now(); const prog = new Set(); const r = await VS.Enhance.run({ blob: raw, envId: 'concrete-studio', fps: FPS, model, jobId: 'hq-' + model, onProgress: (p) => prog.add(p.phase) });
      const m0 = r.masks.raw[0], mw = Math.round(Math.sqrt(m0.length * 4 / 3)), mh = m0.length / mw;
      const g = document.createElement('canvas'); g.width = mw; g.height = mh; const gx = g.getContext('2d', { willReadFrequently: true }); gx.drawImage(gtImg, 0, 0, mw, mh); const gd = gx.getImageData(0, 0, mw, mh).data; const GT = new Uint8Array(mw * mh); for (let k = 0; k < GT.length; k++) GT[k] = gd[k * 4];
      const avg = (arr) => arr.reduce((s, m) => s + C.edgeBandError(m, GT, mw, mh, 4), 0) / arr.length;
      return { model, frames: r.frames, w: r.width, h: r.height, size: r.blob.size, sec: Math.round((performance.now() - t0) / 100) / 10, phases: [...prog], maskSize: [mw, mh], rawEdge: avg(r.masks.raw), smoothEdge: avg(r.masks.smooth), rawFlicker: C.flicker(r.masks.raw), smoothFlicker: C.flicker(r.masks.smooth) }; };
    out.modnet = await runOne('modnet-hq');
    out.hrnet = await runOne('ppmatting-hrnet-hq');
    let rej = null; try { await VS.Enhance.run({ blob: raw, envId: 'concrete-studio', fps: FPS, model: 'birefnet-tiny' }); } catch (e) { rej = e.message; } out.blockedModel = rej;
    return out;
  }, { clipUrl: base + '/tools/e2e/fixtures/raw_clip.webm', gtUrl: base + '/tools/e2e/fixtures/gt_alpha_640x480.png', FPS });
  console.log('info', JSON.stringify(R));
  ok('default offering unchanged (MODNet only)', R.offeredDefault === 'modnet-hq', R.offeredDefault);
  ok('HRNet offered only when opted in', R.offeredOptIn === 'modnet-hq,ppmatting-hrnet-hq', R.offeredOptIn);
  ok('HRNet Enhance completes with 16 frames at source resolution', R.hrnet.frames === 16 && R.hrnet.w === 640 && R.hrnet.h === 480, [R.hrnet.frames, R.hrnet.w, R.hrnet.h]);
  ok('HRNet progress reports model + matting + rendering', ['model', 'matting', 'rendering'].every((p) => R.hrnet.phases.includes(p)), R.hrnet.phases);
  ok('HRNet output file is a real video', R.hrnet.size > 5000, R.hrnet.size);
  ok('not-enabled engines are still refused', /not enabled/.test(R.blockedModel || ''), R.blockedModel);
  ok('page raised no uncaught errors', errs.length === 0, errs.slice(0, 3));
  console.log('COMPARE edge-band error vs ground truth (lower is better): MODNet smooth=' + R.modnet.smoothEdge.toFixed(4) + ' raw=' + R.modnet.rawEdge.toFixed(4) + ' | HRNet smooth=' + R.hrnet.smoothEdge.toFixed(4) + ' raw=' + R.hrnet.rawEdge.toFixed(4));
  console.log('COMPARE flicker (lower is better): MODNet=' + R.modnet.smoothFlicker.toFixed(4) + ' HRNet=' + R.hrnet.smoothFlicker.toFixed(4) + '   seconds: MODNet=' + R.modnet.sec + ' HRNet=' + R.hrnet.sec);
  await browser.close(); srv.close(); console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
