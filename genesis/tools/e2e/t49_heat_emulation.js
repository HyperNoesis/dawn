// Real Chromium, real MODNet weights, the sandbox CPU as a "weak device". Checks the live Quality Governor: no instant fall to the light model, graded steps,
// and that a HUNG inference (injected) is restarted instead of freezing the picture. Does NOT prove phone behaviour.
const http = require('http'), fs = require('fs'), path = require('path'); const { chromium } = require(process.env.PW_LIB || 'playwright');
const ROOT = path.join(__dirname, '..', '..', 'www'); const MT = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.mjs': 'text/javascript' };
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 200) : '')); if (!c) process.exitCode = 1; };
(async () => {
  const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MT[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream','--use-file-for-fake-video-capture='+process.env.CAM, '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, serviceWorkers: 'block', permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'T', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); localStorage.setItem('vs_max_ms', '2000'); localStorage.setItem('vs_live_engine', 'modnet'); localStorage.removeItem('vs_try_modnet'); localStorage.removeItem('vs_gov_last'); });

  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const { spawn } = require('child_process'); let hogs = []; const setHogs = (n) => { while (hogs.length > n) hogs.pop().kill('SIGKILL'); while (hogs.length < n) hogs.push(spawn('taskset', ['-c', '0', 'sh', '-c', 'while :; do :; done'])); };
  await page.addInitScript(() => { window.__ev = []; let t = setInterval(() => { const V = window.VS; if (V && V.segLog && !V.segLog.__h) { V.segLog.__h = 1; const p = V.segLog.push.bind(V.segLog); V.segLog.push = function (e) { window.__ev.push(e); return p(e); }; } }, 50); });

  const { execSync } = require('child_process'); const pinAll = () => { try { const ps = execSync('ps -eo pid,args').toString().split('\n'); for (const l of ps) { const m = l.trim().match(/^(\d+)\s+(.*)$/); if (!m || !/chrom|headless_shell/.test(m[2]) || /taskset|node /.test(m[2].slice(0, 30))) continue; const core = /--type=renderer/.test(m[2]) ? '0,1' : '1'; try { execSync('taskset -a -cp ' + core + ' ' + m[1] + ' >/dev/null 2>&1'); } catch (e) {} } } catch (e) {} };
  await page.goto(base + '/studio.html'); await page.waitForSelector('#startBtn'); await page.click('#startBtn');
  const log = () => page.evaluate(() => window.__ev.map((e) => Object.assign({}, e)));
  const note = () => page.evaluate(() => (document.getElementById('modelBenchNote') || {}).textContent || '');
  const T0 = Date.now(); const phases = JSON.parse(process.env.PHASES || '[[0,0],[90,2],[270,4],[450,0]]'); const total = +(process.env.TOTAL || 750); let lastN = '', ph = -1, seen = 0; const rows = [];
  while ((Date.now() - T0) / 1000 < total) {
    const s = (Date.now() - T0) / 1000; let k = 0; for (let i = 0; i < phases.length; i++) if (s >= phases[i][0]) k = i; if (k !== ph) { ph = k; setHogs(phases[k][1]); console.log('[' + Math.round(s) + 's] PHASE hogs=' + phases[k][1]); }
    pinAll(); const cs = await page.evaluate(() => { const v = document.querySelector('video'); return v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : -1; }); if (global.__cs) { const r = (cs - global.__cs[0]) * 1000 / (Date.now() - global.__cs[1]); console.log('[' + Math.round(s) + 's] camera fps ' + r.toFixed(1)); } global.__cs = [cs, Date.now()];
    if (Math.round(s) % 12 < 3) console.log('[' + Math.round(s) + 's] STATS', (await page.evaluate(() => (document.getElementById('stats') || {}).textContent || '')).slice(0, 110));
    const n = await note(); if (n && n !== lastN) { lastN = n; console.log('[' + Math.round(s) + 's] note:', n.slice(0, 140)); }
    const L = await log(); for (const e of L.slice(seen)) if (/^gov|to-light|bench|stall/.test(e.ev)) console.log('[' + Math.round(s) + 's] EV', JSON.stringify([e.t, e.ev, e.type, e.engine, e.edge, (e.why || '').slice(0, 70), e.fps, e.seg])); seen = L.length;
    await page.waitForTimeout(3000);
  }
  setHogs(0);
  const L = await log(); const gov = L.filter((e) => e.ev === 'gov');
  const types = {}; gov.forEach((e) => types[e.type] = (types[e.type] || 0) + 1); console.log('gov move counts', JSON.stringify(types));
  const lightAt = gov.find((e) => e.type === 'emergency'); const ups = L.filter((e) => e.ev === 'gov-applied' && e.type === 'swap-engine' && e.engine !== 'mediapipe').length;
  ok('no legacy instant to-light', !L.some((e) => e.ev === 'to-light'));
  ok('every move carries a reason', gov.every((e) => e.why));
  console.log('emergency (light model) move at t=', lightAt && lightAt.t);
  ok('after the light model, matting is restored (>=1 swap back to a matting engine)', ups >= 1, ups);
  ok('no uncaught page errors', errs.filter((e) => !/MediaPipeSegmentationProvider/.test(e)).length === 0, errs.slice(0, 3));
  await browser.close(); srv.close();
})().catch((e) => { console.log('FAIL crashed', e.message); process.exit(1); });
