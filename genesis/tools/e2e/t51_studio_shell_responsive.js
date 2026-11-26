// Current Studio shell smoke: all 17 tool panels must be reachable, and the shell
// must not introduce page-level horizontal overflow at phone/tablet/desktop widths.
// This is a navigation/layout gate, not a substitute for complete per-tool journeys.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PW_LIB || 'playwright');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'studio-smoke-artifacts');
const MIME = {
  '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
  '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.webp':'image/webp','.svg':'image/svg+xml','.wasm':'application/wasm','.onnx':'application/octet-stream',
  '.webmanifest':'application/manifest+json','.woff2':'font/woff2','.ico':'image/x-icon'
};
const EXPECTED = 17;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); }
    catch (e) { res.writeHead(400); return res.end('Bad path'); }
    if (pathname === '/') pathname = '/studio.html';
    const file = path.resolve(ROOT, '.' + pathname);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const exe = process.env.CHROME_PATH ||
    ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({
    ...(exe ? { executablePath: exe } : {}),
    args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, serviceWorkers: 'block'
  });
  await context.addInitScript(() => {
    localStorage.setItem('vs_users', JSON.stringify({ 'studio-smoke@test.invalid': { name:'Studio Smoke', password:'fixture-only' } }));
    localStorage.setItem('vs_session', JSON.stringify({ email:'studio-smoke@test.invalid' }));
    localStorage.setItem('vs_autostart', '0');
    localStorage.setItem('vs_ux_rail_more', '1');
  });
  const page = await context.newPage();
  const pageErrors = [], consoleErrors = [], localRequestFailures = [], localHttpErrors = [], failures = [], tabs = [];
  page.on('pageerror', (error) => pageErrors.push(String(error && error.message || error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/ERR_FAILED|net::ERR_/i.test(message.text())) consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(base)) localRequestFailures.push({ url:request.url(), error:request.failure()?.errorText || 'request failed' });
  });
  page.on('response', (response) => {
    if (response.url().startsWith(base) && response.status() >= 400) localHttpErrors.push({ url:response.url(), status:response.status() });
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.goto(base + '/studio.html', { waitUntil:'domcontentloaded' });
  await page.waitForSelector('#startBtn', { timeout:30000 });
  await page.waitForSelector('.tool-tab[data-target]', { timeout:15000 });
  const declared = await page.locator('.tool-tab[data-target]').evaluateAll((items) =>
    items.map((el) => {
      const panel = document.getElementById(el.dataset.target);
      return {
        target:el.dataset.target,
        label:(el.querySelector('.tab-label') || el).textContent.trim(),
        id:el.id,
        role:el.getAttribute('role'),
        controls:el.getAttribute('aria-controls'),
        panelRole:panel && panel.getAttribute('role'),
        panelLabelledBy:panel && panel.getAttribute('aria-labelledby')
      };
    })
  );
  if (declared.length !== EXPECTED) failures.push('Expected ' + EXPECTED + ' Studio tabs, found ' + declared.length);
  for (const item of declared) {
    if (item.role !== 'tab' || !item.id || item.controls !== item.target ||
        item.panelRole !== 'tabpanel' || item.panelLabelledBy !== item.id) {
      failures.push('Broken accessible tab relationship: ' + JSON.stringify(item));
    }
  }
  // Verify keyboard-only movement in the vertical tablist, including Home/End.
  if (declared.length > 1) {
    const first = page.locator('.tool-tab[data-target="' + declared[0].target + '"]');
    await first.focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction((id) => document.querySelector('.tool-tab.active')?.dataset.target === id, declared[1].target, { timeout:3000 });
    await page.keyboard.press('Home');
    await page.waitForFunction((id) => document.querySelector('.tool-tab.active')?.dataset.target === id, declared[0].target, { timeout:3000 });
    await page.keyboard.press('End');
    await page.waitForFunction((id) => document.querySelector('.tool-tab.active')?.dataset.target === id, declared[declared.length - 1].target, { timeout:3000 });
    await page.keyboard.press('Home');
    await page.waitForFunction((id) => document.querySelector('.tool-tab.active')?.dataset.target === id, declared[0].target, { timeout:3000 });
  }
  for (let i = 0; i < declared.length; i++) {
    const item = declared[i];
    try {
      const selector = '.tool-tab[data-target="' + item.target + '"]';
      await page.locator(selector).click({ timeout:10000 });
      await page.waitForFunction((id) => {
        const panel = document.getElementById(id);
        const tab = document.querySelector('.tool-tab[data-target="' + id + '"]');
        return !!panel && panel.classList.contains('active') && panel.getAttribute('role') === 'tabpanel' &&
          !!tab && tab.classList.contains('active') && tab.getAttribute('aria-selected') === 'true';
      }, item.target, { timeout:5000 });
      const geometry = await page.evaluate((id) => {
        const panel = document.getElementById(id), r = panel.getBoundingClientRect();
        return { width:Math.round(r.width), height:Math.round(r.height), display:getComputedStyle(panel).display,
          selectedCount:document.querySelectorAll('.tool-tab[aria-selected="true"]').length };
      }, item.target);
      const passed = geometry.width > 0 && geometry.height > 0 && geometry.display !== 'none' && geometry.selectedCount === 1;
      if (!passed) failures.push('Panel is not visibly laid out: ' + item.target + ' ' + JSON.stringify(geometry));
      const slug = item.target.replace(/[^a-z0-9_-]+/gi, '-');
      await page.screenshot({ path:path.join(OUT, 'tab-' + String(i+1).padStart(2,'0') + '-' + slug + '.png') });
      tabs.push({ ...item, ...geometry, pass:passed });
    } catch (error) {
      failures.push(item.target + ': ' + String(error && error.message || error));
      tabs.push({ ...item, pass:false, error:String(error && error.message || error) });
    }
  }

  const responsive = [];
  for (const viewport of [
    { name:'phone', width:360, height:800 },
    { name:'tablet', width:768, height:1024 },
    { name:'desktop', width:1440, height:900 }
  ]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    await page.waitForTimeout(180);
    const metrics = await page.evaluate(() => {
      const rail = document.getElementById('toolRail');
      const shell = document.querySelector('.studio-shell');
      return {
        innerWidth:window.innerWidth,
        documentWidth:document.documentElement.scrollWidth,
        bodyWidth:document.body ? document.body.scrollWidth : null,
        railWidth:rail ? Math.round(rail.getBoundingClientRect().width) : null,
        shellWidth:shell ? Math.round(shell.getBoundingClientRect().width) : null,
        activeTab:document.querySelector('.tool-tab.active')?.dataset.target || null
      };
    });
    const noHorizontalOverflow = metrics.documentWidth <= viewport.width + 1 &&
      (metrics.bodyWidth == null || metrics.bodyWidth <= viewport.width + 1);
    responsive.push({ ...viewport, ...metrics, noHorizontalOverflow });
    if (!noHorizontalOverflow) failures.push(viewport.name + ' horizontal overflow: ' + JSON.stringify(metrics));
    await page.screenshot({ path:path.join(OUT, 'responsive-' + viewport.name + '.png'), fullPage:true });
  }
  if (pageErrors.length) failures.push('Uncaught page errors: ' + pageErrors.join(' | '));
  if (consoleErrors.length) failures.push('Browser console errors: ' + consoleErrors.join(' | '));
  if (localRequestFailures.length) failures.push('Local resource requests failed: ' + JSON.stringify(localRequestFailures));
  if (localHttpErrors.length) failures.push('Local resources returned HTTP errors: ' + JSON.stringify(localHttpErrors));
  const report = {
    schema:'genesis-studio-shell-smoke-v1',
    url:base + '/studio.html',
    viewportMatrix:responsive,
    expectedTabs:EXPECTED,
    discoveredTabs:declared.length,
    tabs,
    pageErrors,
    consoleErrors,
    localRequestFailures,
    localHttpErrors,
    failures,
    result:failures.length ? 'FAIL' : 'PASS'
  };
  fs.writeFileSync(path.join(OUT, 'studio-shell-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result:report.result, tabCount:declared.length, tabs:tabs.map(t=>({target:t.target,pass:t.pass})), responsive, pageErrors, failures }, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  process.exit(failures.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
