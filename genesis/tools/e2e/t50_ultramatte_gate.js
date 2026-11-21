// Genesis UltraMatte browser gate: load the actual PP-MattingV2 + EdgeTAM weights,
// run the composed provider against Chromium's synthetic camera, and inspect the
// returned alpha. This is a runtime/integration gate, NOT a real-person quality
// benchmark (the source camera clip is synthetic).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW_LIB || 'playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const FIX = path.join(__dirname, 'fixtures');
const REPORT = path.join(ROOT, 'ultramatte_gate_report.json');
const REQUIRED = [
  'models/ppmatting_v2.onnx',
  'models/edgetam_vision_encoder_fp16.onnx',
  'models/edgetam_vision_encoder_fp16.onnx_data',
  'models/edgetam_mask_decoder.onnx',
  'models/edgetam_mask_decoder.onnx_data',
  'models/edgetam_vision_encoder.onnx',
  'models/edgetam_vision_encoder.onnx_data',
  'vendor/ort/ort.min.js',
  'vendor/ort/ort.webgpu.min.js',
  'vendor/ort/ort-wasm-simd-threaded.js',
  'vendor/ort/ort-wasm-simd-threaded.wasm',
  'vendor/ort/ort-wasm-simd-threaded.asyncify.js',
  'vendor/ort/ort-wasm-simd-threaded.asyncify.wasm',
  'js/ort-loader.js'
];

for (const rel of REQUIRED) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    console.error('FAIL missing advanced browser asset: ' + rel);
    console.error('Restore runtime binaries and run scripts/fetch-models.js --only edgetam,ppmatting-v2');
    process.exit(1);
  }
}
if (!fs.existsSync(path.join(FIX, 'webcam_clip.mjpeg'))) {
  console.error('FAIL synthetic camera fixture missing: ' + path.join(FIX, 'webcam_clip.mjpeg'));
  process.exit(1);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.mjpeg': 'multipart/x-mixed-replace',
  '.onnx': 'application/octet-stream', '.onnx_data': 'application/octet-stream',
  '.wasm': 'application/wasm', '.mjs': 'text/javascript'
};

function serveFile(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
  catch (e) { res.writeHead(400); return res.end('bad URL'); }
  const file = path.resolve(ROOT, '.' + pathname);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  const stat = fs.statSync(file);
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start <= end && start < stat.size) {
        res.writeHead(206, {
          'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
          'Content-Length': end - start + 1,
          'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
          'Accept-Ranges': 'bytes'
        });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
    }
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(file).pipe(res);
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' timed out after ' + ms + ' ms')), ms); })
  ]).finally(() => clearTimeout(timer));
}

(async () => {
  const server = http.createServer(serveFile);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const chromePath = process.env.CHROME_PATH || [
    '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
  ].find((candidate) => fs.existsSync(candidate));

  const browser = await chromium.launch({
    ...(chromePath ? { executablePath: chromePath } : {}),
    args: [
      '--no-sandbox',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--use-file-for-fake-video-capture=' + path.join(FIX, 'webcam_clip.mjpeg')
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 900, height: 760 },
    serviceWorkers: 'block',
    permissions: ['camera']
  });
  await context.addInitScript(() => {
    localStorage.setItem('vs_users', JSON.stringify({ 'ultramatte@test.local': { name: 'UltraMatte Gate', password: 'test' } }));
    localStorage.setItem('vs_session', JSON.stringify({ email: 'ultramatte@test.local' }));
    localStorage.setItem('vs_autostart', '0');
    localStorage.setItem('vs_pp_beta', '1');
    localStorage.setItem('vs_hy', '1');
    localStorage.setItem('vs_hy_tiles', '3');
    localStorage.setItem('vs_hy_target_ms', '400');
    localStorage.setItem('vs_hy_warp', '0');
    localStorage.setItem('vs_mask_motion', '0');
    localStorage.setItem('vs_live_engine', 'auto');
    localStorage.setItem('vs_matte_engine', 'auto');
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error && error.message || error)));
  await page.route(/^https?:\/\//, (route) => {
    const url = route.request().url();
    if (url.startsWith(base + '/')) return route.continue();
    return route.abort();
  });

  try {
    await page.goto(base + '/studio.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.VS && window.VS.MatteEngines, null, { timeout: 30000 });
    const ready = await page.evaluate(async () => await window.VS.MatteEngines.ready);
    if (!ready || ready.ready === false) throw new Error('Studio matting engine loader failed: ' + JSON.stringify(ready));

    const result = await page.evaluate(async ({ baseUrl }) => {
      const V = window.VS;
      const engineLoad = await V.MatteEngines.ensureEngine('genesis-hybrid-tam');
      if (!engineLoad || !engineLoad.ok) throw new Error('UltraMatte dependencies failed: ' + (engineLoad && engineLoad.error || 'unknown'));
      if (!V.GenesisHybridProvider || !V.EdgeTAMGate || !V.PPMattingV2Provider) {
        throw new Error('UltraMatte provider graph is incomplete after dependency loading');
      }
      const ort = await V.loadOrt();
      if (!ort || !ort.InferenceSession) throw new Error('Page-thread ONNX runtime did not initialise');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 15 } });
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      await video.play();
      await new Promise((resolve, reject) => {
        const started = performance.now();
        const poll = () => {
          if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) return resolve();
          if (performance.now() - started > 10000) return reject(new Error('Synthetic camera did not become ready'));
          requestAnimationFrame(poll);
        };
        poll();
      });

      const provider = V.MatteEngines.createProvider('genesis-hybrid-tam');
      if (!provider || typeof provider.initialize !== 'function') throw new Error('MatteEngine factory did not construct the selected UltraMatte route');
      const tInit = performance.now();
      await Promise.race([
        provider.initialize('fast', { threads: 1 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('UltraMatte model initialization timed out')), 240000))
      ]);
      const initMs = performance.now() - tInit;
      if (!provider.edgetam || provider.edgetam.status !== 'ready') {
        throw new Error('EdgeTAM did not become ready: ' + JSON.stringify(provider.edgetam || {}));
      }

      const samples = [], hybridFrames = [], masks = [];
      for (let frame = 0; frame < 2; frame++) {
        const t0 = performance.now();
        const output = await Promise.race([
          provider.segment(video),
          new Promise((_, reject) => setTimeout(() => reject(new Error('UltraMatte frame ' + frame + ' timed out')), 120000))
        ]);
        const segmentMs = performance.now() - t0;
        const mask = output && output.segmentationMask;
        if (!mask || !(mask.width > 0 && mask.height > 0)) throw new Error('UltraMatte returned an invalid alpha image on frame ' + frame);

        const canvas = document.createElement('canvas');
        canvas.width = mask.width; canvas.height = mask.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(mask, 0, 0);
        const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let foreground = 0, soft = 0, alphaSum = 0, invalid = 0;
        for (let i = 0; i < rgba.length; i += 4) {
          const a = rgba[i + 3];
          if (!Number.isFinite(a)) invalid++;
          if (a > 16) foreground++;
          if (a > 8 && a < 247) soft++;
          alphaSum += a;
        }
        const pixels = rgba.length / 4;
        const foregroundRatio = foreground / pixels;
        if (invalid) throw new Error('UltraMatte produced non-finite alpha values');
        if (foregroundRatio < 0.01 || foregroundRatio > 0.98) {
          throw new Error('UltraMatte returned an implausible empty/full mask: ' + foregroundRatio);
        }
        samples.push({
          frame, segmentMs: Math.round(segmentMs),
          width: mask.width, height: mask.height,
          foregroundRatio: +foregroundRatio.toFixed(4),
          softEdgeRatio: +(soft / pixels).toFixed(4),
          alphaMean: +(alphaSum / pixels / 255).toFixed(4)
        });
        const frameHybrid = provider.hy || {};
        hybridFrames.push({
          frame, tiles: frameHybrid.tiles || 0, budget: frameHybrid.budget || 0,
          refined: frameHybrid.refined || 0, cached: frameHybrid.cached || 0,
          rejected: frameHybrid.rejected || 0, bandPct: frameHybrid.bandPct || 0,
          errors: frameHybrid.errors || 0, snapshotFailures: frameHybrid.snapshotFailures || 0
        });
        masks.push(mask);
      }

      const hybrid = provider.hy || {};
      const edge = provider.edgetam || {};
      provider.dispose();
      stream.getTracks().forEach((track) => track.stop());
      return {
        label: provider.label,
        ortSource: V.ortSource || 'unknown',
        ortVersion: ort.env && ort.env.versions ? ort.env.versions.web : 'unknown',
        initMs: Math.round(initMs),
        samples,
        hybrid: {
          tiles: hybrid.tiles || 0, budget: hybrid.budget || 0,
          refined: hybrid.refined || 0, rejected: hybrid.rejected || 0,
          bandPct: hybrid.bandPct || 0, size: hybrid.size || null,
          errors: hybrid.errors || 0, snapshotFailures: hybrid.snapshotFailures || 0
        },
        edgeTam: {
          status: edge.status, gateActive: !!edge.gateActive,
          error: edge.error || null
        }
      };
    }, { baseUrl: base });

    if (result.hybrid.errors || result.hybrid.snapshotFailures) {
      throw new Error('Hybrid refinement reported an internal error: ' + JSON.stringify(result.hybrid));
    }
    if (!result.hybridFrames.some((frame) => frame.tiles > 0 && frame.budget > 0 && frame.refined > 0)) {
      throw new Error('UltraMatte passed without executing high-resolution tile refinement on either camera frame: ' + JSON.stringify(result.hybridFrames));
    }
    if (result.edgeTam.status !== 'ready') throw new Error('EdgeTAM status is not ready: ' + JSON.stringify(result.edgeTam));
    if (!result.edgeTam.gateActive) throw new Error('EdgeTAM did not produce an active subject gate: ' + JSON.stringify(result.edgeTam));
    if (!pageErrors.length) {
      console.log('PASS actual PP-MattingV2 + EdgeTAM/Hybrid browser inference');
    } else {
      throw new Error('Browser page errors: ' + pageErrors.join(' | '));
    }

    fs.writeFileSync(REPORT, JSON.stringify({ pass: true, ...result, pageErrors }, null, 2));
    console.log('ULTRAMATTE_REPORT ' + JSON.stringify(result));
    console.log('PASS UltraMatte returned non-empty alpha on 2 camera frames');
  } catch (error) {
    fs.writeFileSync(REPORT, JSON.stringify({ pass: false, error: String(error && error.stack || error), pageErrors }, null, 2));
    throw error;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
