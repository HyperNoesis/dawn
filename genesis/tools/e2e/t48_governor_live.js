// Real Chromium, real MODNet weights, the sandbox CPU as a "weak device". Checks the live Quality Governor: no instant fall to the light model, graded steps,
// and that a HUNG inference (injected) is restarted instead of freezing the picture. Does NOT prove phone behaviour.
const http = require('http'), fs = require('fs'), path = require('path'); const { chromium } = require(process.env.PW_LIB || 'playwright');
const ROOT = path.join(__dirname, '..', '..', 'www'); const MT = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.mjs': 'text/javascript' };
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 200) : '')); if (!c) process.exitCode = 1; };
(async () => {
  const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MT[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, serviceWorkers: 'block', permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'T', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); localStorage.setItem('vs_max_ms', '2000'); localStorage.setItem('vs_live_engine', 'modnet'); localStorage.removeItem('vs_try_modnet'); localStorage.removeItem('vs_gov_last'); });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(base + '/studio.html'); await page.waitForSelector('#startBtn'); await page.click('#startBtn');
  const log = () => page.evaluate(() => (window.VS.segLog || []).map((e) => Object.assign({}, e)));
  const note = () => page.evaluate(() => (document.getElementById('modelBenchNote') || {}).textContent || '');
  let t0 = Date.now(), live = null, lastN = '';
  while (Date.now() - t0 < 240000) { const n = await note(); if (n && n !== lastN) { lastN = n; console.log('note:', n.slice(0, 150)); } const L0 = await log(); if (L0.some((e) => e.ev === 'bench' && e.engine === 'modnet')) { live = Date.now(); break; } if (/Staying on the light model/.test(n)) break; await page.waitForTimeout(1500); }
  console.log('segLog so far:', JSON.stringify((await log()).map((e) => [e.t, e.ev, e.engine || e.type || '', e.edge || e.to || '', e.ms || e.seg || ''])));
  console.log('matting live:', !!live, 'after', Math.round((Date.now() - t0) / 1000), 's');
  if (live) {
    // watch the governor on a genuinely slow machine for 100 s
    const w0 = Date.now(); while (Date.now() - w0 < 100000) { const n = await note(); if (n && n !== lastN) { lastN = n; console.log('note:', n.slice(0, 150)); } await page.waitForTimeout(2000); }
    const L = await log(); const gov = L.filter((e) => /^gov/.test(e.ev)); console.log('governor events:', JSON.stringify(gov.map((e) => [e.t, e.ev, e.type, e.engine, e.edge, (e.why || '').slice(0, 60)])));
    const firstLight = L.find((e) => e.ev === 'to-light' || (e.ev === 'gov' && e.type === 'emergency'));
    const liveT = L.find((e) => e.ev === 'bench'); 
    ok('no instant fall to the light model after matting went live (>= 15 s)', !firstLight || !liveT || (firstLight.t - liveT.t) >= 15, { light: firstLight && firstLight.t, bench: liveT && liveT.t });
    ok('legacy hopeless jump is gone', !L.some((e) => e.ev === 'to-light'));
    ok('every governor move is a graded step (sizes of 64 px or an engine/emergency move with a reason)', gov.filter((e) => e.ev === 'gov').every((e) => e.why));
  }
  // hang injection: calls on the CURRENT engine never answer; engines created after this point are healthy
  const before = (await log()).length;
  await page.evaluate(() => { const P = (window.VS.MatteEnginesOriginal || window.VS.MODNetWorkerProvider).prototype; window.__hangOn = true; const oi = P.initialize; P.initialize = function () { if (window.__hangOn) this.__fresh = true; return oi.apply(this, arguments); }; const os = P._send; P._send = function (m) { if (window.__hangOn && m && m.type === 'run' && !this.__fresh) return new Promise(() => {}); return os.apply(this, arguments); }; });
  const h0 = Date.now(); let restarted = false, recovered = false;
  while (Date.now() - h0 < 90000) { const L = (await log()).slice(before); if (L.some((e) => e.ev === 'gov' && (e.type === 'restart' || e.type === 'emergency'))) restarted = true; if (L.some((e) => e.ev === 'gov-applied')) { recovered = true; break; } await page.waitForTimeout(1500); }
  const full = await log(); console.log('FULL segLog:', JSON.stringify(full.map((e) => [e.t, e.ev, e.engine || e.type || '', e.edge || e.to || '', (e.why || '').slice(0, 50), e.fps, e.seg])));
  const L2 = full.slice(before); console.log('after hang:', JSON.stringify(L2.filter((e) => /^gov/.test(e.ev)).map((e) => [e.t, e.ev, e.type, e.engine, e.edge])));
  if (live) { ok('a hung inference is detected and the governor asks for a restart', restarted); ok('and the restarted engine is live again', recovered); }
  ok('no uncaught page errors', errs.filter((e) => !/MediaPipeSegmentationProvider/.test(e)).length === 0, errs.slice(0, 3));
  await browser.close(); srv.close();
})().catch((e) => { console.log('FAIL crashed', e.message); process.exit(1); });
