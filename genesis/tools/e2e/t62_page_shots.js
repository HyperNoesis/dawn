// Screenshot every top-level page at 3 viewports (no camera, reduced motion) for before/after CSS comparison.
// Usage: node tools/e2e/t62_page_shots.js <outdir>
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PW_LIB || 'playwright');
const root = path.resolve(__dirname, '../..'), outdir = path.resolve(process.argv[2] || '/tmp/shots'); fs.mkdirSync(outdir, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mjs': 'text/javascript', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
const SKIP = new Set(['tests.html', 'components.html']);
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html') && !SKIP.has(f));
  let n = 0, errs = 0;
  for (const [vn, w, h] of [['phone', 390, 844], ['tablet', 820, 1180], ['desktop', 1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block', reducedMotion: 'reduce', deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'Tester', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); });
    for (const f of pages) {
      const page = await ctx.newPage(); const e = []; page.on('pageerror', (x) => e.push(x.message));
      try { await page.goto(base + '/' + f, { waitUntil: 'load', timeout: 20000 }); await page.waitForTimeout(1200); await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;caret-color:transparent!important}' }); await page.screenshot({ path: path.join(outdir, `${f.replace('.html', '')}_${vn}.png`), fullPage: false }); n++; } catch (x) { console.log('shot failed', f, vn, x.message.split('\n')[0]); }
      if (e.length) { errs++; console.log('pageerror', f, vn, e[0]); }
      await page.close();
    }
    await ctx.close();
  }
  console.log('screenshots', n, 'pages-with-errors', errs); await browser.close(); server.close();
})();
