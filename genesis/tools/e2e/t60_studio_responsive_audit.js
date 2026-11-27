// Studio responsive + accessibility audit (fake camera, software GL). Writes reports/studio_audit_<label>.json and screenshots.
// Usage: node tools/e2e/t60_studio_responsive_audit.js [label]   (PW_LIB / CHROME_PATH as in pwlib.js)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PW_LIB || 'playwright');
const root = path.resolve(__dirname, '../..'), label = process.argv[2] || 'run';
const out = path.join(root, 'reports'), shots = path.join(out, 'screenshots'); fs.mkdirSync(shots, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png', '.mjs': 'text/javascript' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }); fs.createReadStream(f).pipe(r);
});
const VIEWS = [['phone', 390, 844], ['tablet', 820, 1180], ['desktop', 1440, 900]];
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const report = { label, views: {} }; let fail = 0;
  for (const [name, w, h] of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block', permissions: ['camera', 'microphone'], hasTouch: name !== 'desktop', isMobile: name === 'phone', reducedMotion: 'reduce' });
    await ctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'Tester', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); localStorage.setItem('vs_try_modnet', '0'); });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await page.goto(base + '/studio.html'); await page.waitForSelector('#startBtn'); await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shots, `${label}_${name}_idle.png`) });
    const audit = () => page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.getAttribute('title') || (e.labels && e.labels.length && 'label') || e.textContent.trim() || e.getAttribute('placeholder') || '');
      const ctrls = [...document.querySelectorAll('button,input:not([type=hidden]),select,textarea,[role=button],[role=tab]')].filter(vis);
      const unlabeled = ctrls.filter((e) => !name(e)).map((e) => e.id || e.className || e.tagName).slice(0, 25);
      const small = ctrls.filter((e) => { const lab = (e.type === 'checkbox' || e.type === 'radio') && e.closest('label'); const r = (lab || e).getBoundingClientRect(); return Math.min(r.width, r.height) < 24; }).map((e) => e.id || e.className || e.tagName).slice(0, 25);
      const de = document.documentElement;
      return { overflowX: de.scrollWidth - de.clientWidth, controls: ctrls.length, unlabeled, tooSmall: small, h1: document.querySelectorAll('h1').length, lang: de.lang, title: document.title, liveRegions: document.querySelectorAll('[aria-live],[role=status],[role=alert]').length };
    });
    const idle = await audit();
    await page.click('#startBtn'); await page.waitForTimeout(6000);
    await page.screenshot({ path: path.join(shots, `${label}_${name}_live.png`) });
    const live = await audit();
    const started = await page.evaluate(() => { const v = document.querySelector('video'); return !!(v && v.videoWidth > 0); });
    // keyboard: first Tab must land on a visible focusable element with a visible focus indicator
    await page.keyboard.press('Tab'); const focus = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); return { tag: e.tagName, id: e.id, outline: s.outlineStyle + ' ' + s.outlineWidth, shadow: s.boxShadow !== 'none' }; });
    report.views[name] = { viewport: [w, h], cameraStarted: started, idle, live, firstFocus: focus, errors: errs.slice(0, 10) };
    console.log((errs.length || idle.overflowX > 1 || live.overflowX > 1 || !started ? 'FAIL ' : 'PASS ') + name, JSON.stringify({ started, overflow: [idle.overflowX, live.overflowX], unlabeled: live.unlabeled.length, tooSmall: live.tooSmall.length, errors: errs.length }));
    if (errs.length || idle.overflowX > 1 || live.overflowX > 1 || !started) fail++;
    await ctx.close();
  }
  fs.writeFileSync(path.join(out, `studio_audit_${label}.json`), JSON.stringify(report, null, 1));
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
