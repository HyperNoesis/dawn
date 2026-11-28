// Studio soak: fake camera+mic, optional CPU throttle, record for SOAK_SEC seconds while sampling FPS + JS heap, then verify the saved file:
// video duration ~= wall time, audio decodes and has the same duration, heap does not grow without bound, no page errors, preview never freezes.
// Usage: SOAK_SEC=300 CPU=4 node tools/e2e/t65_studio_soak.js
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PW_LIB || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), SOAK = Number(process.env.SOAK_SEC || 300), CPU = Number(process.env.CPU || 1);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png', '.mjs': 'text/javascript' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }); fs.createReadStream(f).pipe(r); });
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'T', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  if (CPU > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU }); }
  await page.goto(base + '/studio.html'); await page.waitForSelector('#startBtn');
  await page.click('#startBtn'); await page.waitForTimeout(8000);
  const t0 = Date.now(); await page.click('#recordBtn');
  const samples = []; let frozen = 0, lastFrames = -1;
  while ((Date.now() - t0) / 1000 < SOAK) {
    await page.waitForTimeout(15000);
    const s = await page.evaluate(() => { const v = document.querySelector('video'), st = document.getElementById('stats').textContent, m = /FPS:\s*([\d.]+)/.exec(st); return { t: Math.round(performance.now() / 1000), fps: m ? Number(m[1]) : null, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, camFrames: v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : null, stats: st }; });
    if (s.camFrames === lastFrames) frozen++; lastFrames = s.camFrames; samples.push(s); console.log(JSON.stringify({ min: +((Date.now() - t0) / 60000).toFixed(1), fps: s.fps, heapMB: s.heapMB, camFrames: s.camFrames }));
  }
  const wall = (Date.now() - t0) / 1000; await page.click('#recordBtn'); await page.waitForTimeout(6000);
  const file = await page.evaluate(async () => {
    const l = await window.VS.storage.listRecordings(); if (!l.length) return null; const r = await window.VS.storage.getRecording(l[0].id), b = r.blob || r;
    const url = URL.createObjectURL(b), v = document.createElement('video'); v.src = url; v.muted = true; await new Promise((res) => { v.onloadedmetadata = res; v.onerror = res; });
    if (!isFinite(v.duration)) { v.currentTime = 1e7; await new Promise((res) => { v.ontimeupdate = res; setTimeout(res, 5000); }); }
    const out = { bytes: b.size, type: b.type, videoDur: v.duration, w: v.videoWidth, h: v.videoHeight, audioDur: null, audioRms: null };
    try { const ac = new AudioContext(), buf = await ac.decodeAudioData(await b.arrayBuffer()), d = buf.getChannelData(0); let s2 = 0; for (let i = 0; i < d.length; i += 11) s2 += d[i] * d[i]; out.audioDur = buf.duration; out.audioRms = Math.sqrt(s2 / (d.length / 11)); } catch (e) { out.audioErr = String(e.message || e); }
    return out;
  });
  const heap = samples.map((s) => s.heapMB).filter((x) => x != null), fps = samples.map((s) => s.fps).filter((x) => x != null);
  const half = Math.floor(heap.length / 2), growth = heap.length > 3 ? heap[heap.length - 1] - Math.min(...heap.slice(1, half + 1)) : null;
  const res = { soakSec: SOAK, cpuThrottle: CPU, wallSec: Math.round(wall), samples: samples.length, fpsMin: Math.min(...fps), fpsMedian: fps.sort((a, b) => a - b)[Math.floor(fps.length / 2)], heapStartMB: heap[0], heapEndMB: heap[heap.length - 1], heapMaxMB: Math.max(...heap), heapGrowthMB: growth, frozenSamples: frozen, file, pageErrors: errs.length };
  console.log('RESULT', JSON.stringify(res, null, 1));
  const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);
  ok('preview never froze (camera frame counter advanced every sample)', frozen === 0);
  ok('file saved with real bytes', file && file.bytes > 100000);
  ok('video duration within 3 s of wall time', file && Math.abs(file.videoDur - wall) < 3);
  ok('audio decodes, same duration (A/V drift under 1.5 s), not silent', file && file.audioDur && Math.abs(file.audioDur - file.videoDur) < 1.5 && file.audioRms > 0.001);
  ok('heap growth under 150 MB over the soak', growth == null || growth < 150);
  ok('no page errors', errs.length === 0);
  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'reports', `soak_cpu${CPU}_${SOAK}s.json`), JSON.stringify({ res, samples }, null, 1));
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(2); });
