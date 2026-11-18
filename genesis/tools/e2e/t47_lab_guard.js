// v0.94 gate: matting lab in real Chromium with real weights. (1) MODNet baseline vs PP-MattingV2 vs HRNet on the SAME frame with the synthetic ground truth,
// (2) live loop on the clip, (3) VideoGuard inside the real provider: subject disappears -> held + faded out -> reappears -> temporal reset, never a stuck/black frame.
// Synthetic fixture; CPU/WASM timings mean nothing for phones. Needs models/ppmatting_v2.onnx, models/ppmatting_v1.onnx, models/modnet.onnx.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), { chromium } = require(process.env.PW_LIB || 'playwright');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.webm': 'video/webm', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.mjs': 'text/javascript' };
(async () => {
  for (const f of ['ppmatting_v2.onnx', 'ppmatting_v1.onnx', 'modnet.onnx']) if (!fs.existsSync(path.join(ROOT, 'models', f))) { console.log('SKIPPED: models/' + f + ' missing'); process.exit(0); }
  const srv = http.createServer((q, r) => { const p = decodeURIComponent(q.url.split('?')[0]), f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'content-length': fs.statSync(f).size }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ serviceWorkers: 'block' }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(base + '/ppmatting-lab.html'); await page.waitForFunction(() => window.__lab, null, { timeout: 60000 });
  let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
  const R = await page.evaluate(async ({ img, gt, clip }) => {
    const L = window.__lab, $ = (id) => document.getElementById(id), out = {};
    const load = (u) => new Promise((y, n) => { const i = new Image(); i.onload = () => y(i); i.onerror = n; i.src = u; });
    const src = await load(img), g = await load(gt); const c = document.createElement('canvas'); c.width = g.naturalWidth; c.height = g.naturalHeight; const x = c.getContext('2d'); x.drawImage(g, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data, a = new Uint8Array(c.width * c.height); for (let k = 0; k < a.length; k++) a[k] = d[k * 4]; L.st.gt = { a, w: c.width, h: c.height };
    $('backend').value = 'wasm'; $('quality').value = 'balanced';
    out.still = {}; for (const id of ['modnet', 'ppmatting-v2', 'ppmatting-hrnet']) { $('engine').value = id; const r = await L.matteStill(src); out.still[id] = { ms: Math.round(r.ms), gt: L.st.stats.gt }; }
    const rep = L.buildReport(); out.sadRatio = rep.sadRatio; out.gradRatio = rep.gradRatio; out.runsKeys = Object.keys(rep.runs);
    // live loop with the real provider on the clip
    $('engine').value = 'ppmatting-v2'; if (L.st.provider) { L.st.provider.dispose(); L.st.provider = null; }
    const v = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true; v.src = clip; await new Promise((y) => { v.onloadeddata = y; }); await v.play();
    out.live = await L.live(v, 24); v.pause();
    // guard inside the real provider: subject (clip frame) -> empty gray frame -> subject again
    const p = L.st.provider; p.resetTemporal(); const fake = (cv) => { cv.videoWidth = cv.width; cv.videoHeight = cv.height; return cv; };
    const subj = document.createElement('canvas'); subj.width = 640; subj.height = 480; subj.getContext('2d').drawImage(src, 0, 0); fake(subj);
    const empty = document.createElement('canvas'); empty.width = 640; empty.height = 480; const ex = empty.getContext('2d'); ex.fillStyle = '#707070'; ex.fillRect(0, 0, 640, 480); fake(empty);
    const trace = []; const cov = (arr) => { let n = 0; for (let i = 0; i < arr.length; i++) if (arr[i] > 127) n++; return n / arr.length; };
    const shownCov = async () => { const r = await p.segment(arguments[0]); return r; };
    const step = async (cv, tag) => { await p.segment(cv); const gd = p.lastGuard; const out2 = p._outImageData.data; let n = 0, tot = out2.length / 4; for (let i = 0; i < tot; i++) if (out2[i * 4 + 3] > 127) n++; trace.push({ tag, state: gd && gd.state, held: gd && gd.useHeld, fade: gd && Math.round(gd.fade * 100) / 100, reset: gd && gd.resetTemporal, reasons: gd && gd.reasons, shown: Math.round(n / tot * 1000) / 1000, raw: Math.round(cov(p.lastRaw) * 1000) / 1000 }); };
    for (let i = 0; i < 6; i++) await step(subj, 'subject');
    for (let i = 0; i < 16; i++) await step(empty, 'empty');
    for (let i = 0; i < 3; i++) await step(subj, 'back');
    out.trace = trace; out.guardSupported = !!p.guard;
    return out;
  }, { img: base + '/tools/e2e/fixtures/frame0_640x480.png', gt: base + '/tools/e2e/fixtures/gt_alpha_640x480.png', clip: base + '/tools/e2e/fixtures/raw_clip.webm' });
  console.log('still (SAD/MAD/grad vs synthetic GT):', JSON.stringify(R.still));
  console.log('ratios vs MODNet baseline: sad', R.sadRatio, 'grad', R.gradRatio);
  console.log('live', JSON.stringify(R.live)); console.log('trace', R.trace.map((t) => t.tag[0] + ':' + t.state + (t.held ? '(h' + t.fade + ')' : '') + (t.reset ? '[R]' : '') + ' shown=' + t.shown).join(' | '));
  ok('all three engines ran and have ground-truth numbers', ['modnet', 'ppmatting-v2', 'ppmatting-hrnet'].every((k) => R.still[k] && R.still[k].gt && isFinite(R.still[k].gt.sad)));
  ok('lab computed sad/grad ratios vs the MODNet baseline', typeof R.sadRatio === 'number' && typeof R.gradRatio === 'number', [R.sadRatio, R.gradRatio]);
  ok('live loop: 24 frames, 0 failures, 0 black frames', R.live.frames === 24 && R.live.failures === 0 && R.live.blackFrames === 0, R.live);
  ok('guard is active in the real provider', R.guardSupported === true);
  const T = R.trace, lastEmpty = T.filter((t) => t.tag === 'empty').pop(), firstHeld = T.find((t) => t.held), back = T.filter((t) => t.tag === 'back');
  ok('subject lost -> matte is HELD (not dropped at once)', !!firstHeld && firstHeld.shown > 0.02, firstHeld);
  ok('held matte fades out completely (no stuck mask)', lastEmpty.shown === 0, lastEmpty.shown);
  ok('subject returns -> temporal reset once, tracking again, matte restored', back[0].reset === true && back[0].state === 'tracking' && back[0].shown > 0.02 && !back[1].reset, back.map((b) => [b.state, b.reset, b.shown]));
  ok('no uncaught page errors', errs.length === 0, errs.slice(0, 3));
  await browser.close(); srv.close(); console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
