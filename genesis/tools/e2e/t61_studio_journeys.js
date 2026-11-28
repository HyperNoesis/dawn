// Studio user journeys (fake camera/mic, software GL): guest record->save->reload->find, scene select persistence,
// camera stop/restart, camera permission denied (no hang, honest state), mic-less failure.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PW_LIB || 'playwright');
const root = path.resolve(__dirname, '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png', '.mjs': 'text/javascript' };
const server = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }); fs.createReadStream(f).pipe(r); });
const R = []; const ok = (n, c, d) => { R.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' ' + JSON.stringify(d) : '')); };
const ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
const seed = () => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'Tester', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); localStorage.setItem('vs_try_modnet', '0'); };
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  const exe = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
  // ---- granted browser
  let browser = await chromium.launch({ ...exe, args: [...ARGS, '--use-fake-ui-for-media-stream'] });
  let ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block', permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(seed); let errs = [];
  const open = async () => { const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); await p.goto(base + '/studio.html'); await p.waitForSelector('#startBtn'); return p; };
  let page = await open();
  const camOn = () => page.evaluate(() => { const v = document.querySelector('video'); return !!(v && v.videoWidth > 0 && !v.paused); });
  await page.click('#startBtn'); await page.waitForTimeout(5000);
  ok('J1 camera starts from a user click', await camOn());
  // choose a scene (second environment card) and remember which
  const cards = await page.$$('#envMiniGrid .env-card'); ok('J1 environments are listed', cards.length >= 2, cards.length);
  const envBefore = await page.evaluate(() => document.getElementById('envSelect').value);
  if (cards.length >= 2) await cards[1].click(); await page.waitForTimeout(800);
  const envAfter = await page.evaluate(() => document.getElementById('envSelect').value);
  ok('J1 selecting a scene changes the active environment', envAfter && envAfter !== envBefore, { envBefore, envAfter });
  // record, stop, saved
  await page.click('#recordBtn'); await page.waitForTimeout(4500);
  const recClass = await page.evaluate(() => document.getElementById('recordBtn').className);
  ok('J1 record button reflects recording state', /recording/.test(recClass), recClass);
  await page.click('#recordBtn'); await page.waitForTimeout(2500);
  const saved = await page.evaluate(async () => { const l = await window.VS.storage.listRecordings(); if (!l.length) return null; const r = await window.VS.storage.getRecording(l[0].id); const b = r.blob || r; return { n: l.length, size: b.size, type: b.type }; });
  ok('J1 recording saved with real bytes', saved && saved.size > 10000, saved);
  // J2 reload: recording persists, scene setup restored, no duplicate
  await page.reload(); await page.waitForSelector('#startBtn'); await page.waitForTimeout(1500);
  const after = await page.evaluate(async () => ({ n: (await window.VS.storage.listRecordings()).length, env: document.getElementById('envSelect').value }));
  ok('J2 reload keeps exactly the saved recording (no loss, no duplicate)', after.n === saved.n, after);
  ok('J2 reload restores the chosen scene', after.env === envAfter, after);
  // Projects page lists it
  const pp = await ctx.newPage(); pp.on('pageerror', (e) => errs.push('projects: ' + e.message)); await pp.goto(base + '/projects.html'); await pp.waitForTimeout(2000);
  const listed = await pp.evaluate(() => document.body.innerText.length > 50 && !!document.querySelector('video, .recording-item, .project-card, .p-thumb, [data-rec-id]'));
  ok('J1 Projects page shows the saved recording', listed); await pp.close();
  // stop / restart camera
  await page.click('#startBtn'); await page.waitForTimeout(4000); ok('J3 camera starts after reload', await camOn());
  await page.click('#stopBtn'); await page.waitForTimeout(1500);
  const stopped = await page.evaluate(() => { const v = document.querySelector('video'); const live = v && v.srcObject && v.srcObject.getTracks().some((t) => t.readyState === 'live'); return { live: !!live, label: document.getElementById('startBtn').textContent.trim() }; });
  ok('J3 Stop releases camera/mic tracks', !stopped.live, stopped);
  await page.click('#startBtn'); await page.waitForTimeout(4000); ok('J3 camera restarts after stop', await camOn());
  // camera track ended mid-session: app must report, not hang
  await page.evaluate(() => { const v = document.querySelector('video'); v.srcObject.getTracks().forEach((t) => { t.stop(); t.dispatchEvent(new Event('ended')); }); });
  await page.waitForTimeout(2500);
  const lost = await page.evaluate(() => ({ btn: document.getElementById('startBtn').textContent.trim(), disabled: document.getElementById('startBtn').disabled }));
  ok('J3 lost camera track leaves Start usable (no stuck/disabled button)', !lost.disabled, lost);
  // J6 Go Live: bad scheme is caught, a rejecting server never shows as connected, camera keeps working
  await page.reload(); await page.waitForSelector('#startBtn'); await page.click('#startBtn'); await page.waitForTimeout(4500);
  await page.click('.tool-tab[data-target="panel-live"]'); await page.waitForTimeout(500);
  await page.click('.wizard-choice[data-dest="whip"]'); await page.click('.wizard-to-step3'); await page.waitForTimeout(300);
  await page.fill('#whipEndpointInput', 'rtmp://example.com/live/key');
  ok('J6 RTMP url explained, not accepted as WHIP', await page.isVisible('#whipSchemeError'));
  await page.click('#saveWhipBtn'); ok('J6 Go Live stays disabled for invalid endpoint', await page.isDisabled('#goLiveBtn'));
  await ctx.route('https://whip.invalid/**', (r) => r.fulfill({ status: 401, body: 'unauthorized' }));
  await page.fill('#whipEndpointInput', 'https://whip.invalid/whip/x'); await page.click('#saveWhipBtn'); await page.waitForTimeout(300);
  ok('J6 Go Live enabled for a valid-looking endpoint', !(await page.isDisabled('#goLiveBtn')));
  await page.click('#goLiveBtn'); await page.waitForTimeout(6000);
  const live = await page.evaluate(() => ({ status: (document.getElementById('liveStatusText') || {}).textContent, btn: document.getElementById('goLiveBtn').textContent.trim(), health: (document.getElementById('liveHealth') || {}).textContent }));
  ok('J6 rejected publish never claims connected/live', !/^(live|connected|on air)/i.test((live.status || '').trim()) && !/stop|end/i.test(live.btn), live);
  // second click ("Go live anyway") must actually attempt the publish and then surface the server rejection honestly
  await page.click('#goLiveBtn'); await page.waitForTimeout(6000);
  const live2 = await page.evaluate(() => ({ status: (document.getElementById('liveStatusText') || {}).textContent, btn: document.getElementById('goLiveBtn').textContent.trim(), text: document.getElementById('panel-live').innerText.toLowerCase() }));
  ok('J6 after the real attempt the UI is not live and names the failure', !/^(live|connected|on air)/i.test((live2.status || '').trim()) && /(reject|fail|unauthor|401|could not|error|denied|not reach)/.test(live2.text), { status: live2.status, btn: live2.btn });
  ok('J6 camera preview still running after failed publish', await camOn());
  ok('no page errors in granted session', errs.length === 0, errs);
  await browser.close(); server.close ? 0 : 0;
  // ---- denied browser: no fake-ui flag + no permission => getUserMedia rejects
  browser = await chromium.launch({ ...exe, args: ARGS });
  ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block', permissions: [] }); await ctx.addInitScript(seed);
  errs = []; page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(e.message)); await page.goto(base + '/studio.html'); await page.waitForSelector('#startBtn');
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })); });
  await page.click('#startBtn'); await page.waitForTimeout(3500);
  const den = await page.evaluate(() => ({ disabled: document.getElementById('startBtn').disabled, text: document.body.innerText.toLowerCase() }));
  ok('J3 permission denied: Start button is not left disabled', !den.disabled);
  ok('J3 permission denied: user sees an explanation mentioning camera/permission', /permission|blocked|camera/.test(den.text) && /(allow|permission|blocked|denied)/.test(den.text));
  const retried = await page.evaluate(() => { let called = 0; navigator.mediaDevices.getUserMedia = () => { called++; return Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); }; document.getElementById('startBtn').click(); return new Promise((r) => setTimeout(() => r(called), 1500)); });
  ok('J3 can retry after denial (no dead state)', retried >= 1, retried);
  ok('no page errors in denied session', errs.length === 0, errs);
  await browser.close(); server.close();
  process.exit(R.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
