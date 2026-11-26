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
if (!fs.existsSync(path.join(FIX, 'gt_alpha_640x480.png'))) {
  console.error('FAIL synthetic ground-truth alpha fixture missing: ' + path.join(FIX, 'gt_alpha_640x480.png'));
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

      // The camera clip is generated from a labelled synthetic subject. Keep
      // the exact alpha reference in the report so we can track quality changes
      // over time; this is a deterministic regression fixture, not real-person proof.
      const loadImage = (url) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not load reference image: ' + url));
        image.src = url;
      });
      const gtImage = await loadImage(baseUrl + '/tools/e2e/fixtures/gt_alpha_640x480.png');
      if (gtImage.naturalWidth !== 640 || gtImage.naturalHeight !== 480) {
        throw new Error('Synthetic ground-truth alpha must be 640x480, got ' + gtImage.naturalWidth + 'x' + gtImage.naturalHeight);
      }
      const gtCanvas = document.createElement('canvas');
      gtCanvas.width = 640; gtCanvas.height = 480;
      const gtCtx = gtCanvas.getContext('2d', { willReadFrequently: true });
      if (!gtCtx) throw new Error('Could not create ground-truth alpha readback canvas');
      gtCtx.drawImage(gtImage, 0, 0, 640, 480);
      const gtFullRgba = gtCtx.getImageData(0, 0, 640, 480).data;
      const scoreAlpha = (prediction, predictionChannel, reference, referenceChannel, width, height) => {
        const count = width * height;
        let absolute = 0, edgeAbsolute = 0, edgeCount = 0;
        let intersection = 0, union = 0, predForeground = 0, refForeground = 0;
        for (let i = 0; i < count; i++) {
          const p = prediction[i * 4 + predictionChannel];
          const g = reference[i * 4 + referenceChannel];
          absolute += Math.abs(p - g);
          if (g > 8 && g < 247) { edgeAbsolute += Math.abs(p - g); edgeCount++; }
          const pf = p > 127, gf = g > 127;
          if (pf) predForeground++;
          if (gf) refForeground++;
          if (pf && gf) intersection++;
          if (pf || gf) union++;
        }
        return {
          alphaMAE: +(absolute / Math.max(1, count) / 255).toFixed(4),
          edgeMAE: edgeCount ? +(edgeAbsolute / edgeCount / 255).toFixed(4) : null,
          foregroundIoU: +(intersection / Math.max(1, union)).toFixed(4),
          predictedForegroundRatio: +(predForeground / Math.max(1, count)).toFixed(4),
          referenceForegroundRatio: +(refForeground / Math.max(1, count)).toFixed(4)
        };
      };

      const provider = V.MatteEngines.createProvider('genesis-hybrid-tam');
      if (!provider || typeof provider.initialize !== 'function') throw new Error('MatteEngine factory did not construct the selected UltraMatte route');
      if (!V.GLMatte) throw new Error('Studio GLMatte edge/decontamination stage was not loaded');
      const edgeMatte = new V.GLMatte();
      if (!edgeMatte.ok) throw new Error('Studio GLMatte failed to initialize: ' + (edgeMatte.error || 'unknown'));
      // Diagnostic-only A/B: widen the alpha transition while keeping every
      // other renderer parameter identical. Do not change Studio defaults until
      // labelled-reference scores and the existing edge suite agree.
      const softEdgeMatte = new V.GLMatte();
      if (!softEdgeMatte.ok) throw new Error('Soft-edge A/B GLMatte failed to initialize: ' + (softEdgeMatte.error || 'unknown'));
      softEdgeMatte.edgeProfile = 'fixed';
      softEdgeMatte.edgeLo = 0.15;
      softEdgeMatte.edgeHi = 0.85;
      // A second, deliberately conservative transition tests whether the
      // current 0.30/0.70 tightening is erasing useful hair/antialias alpha.
      const featherEdgeMatte = new V.GLMatte();
      if (!featherEdgeMatte.ok) throw new Error('Feather-edge A/B GLMatte failed to initialize: ' + (featherEdgeMatte.error || 'unknown'));
      featherEdgeMatte.edgeProfile = 'fixed';
      featherEdgeMatte.edgeLo = 0.05;
      featherEdgeMatte.edgeHi = 0.95;
      const tInit = performance.now();
      await Promise.race([
        provider.initialize('fast', { threads: 1 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('UltraMatte model initialization timed out')), 240000))
      ]);
      const initMs = performance.now() - tInit;
      if (!provider.edgetam || provider.edgetam.status !== 'ready') {
        throw new Error('EdgeTAM did not become ready: ' + JSON.stringify(provider.edgetam || {}));
      }

      // Verify the exact live provider identity against the real loaded model
      // bytes, pre/post-processing sources, and ONNX runtime assets. This is
      // identity integrity, not a human-footage quality approval.
      if (typeof provider.getQualificationIdentity !== 'function') {
        throw new Error('UltraMatte provider did not expose its runtime qualification identity');
      }
      const qualificationIdentity = await provider.getQualificationIdentity();
      const identityApi = V.MatteQualificationIdentity;
      if (!identityApi || !identityApi.validHash(qualificationIdentity.modelSha256) ||
          !identityApi.validHash(qualificationIdentity.preprocessHash) ||
          !identityApi.validHash(qualificationIdentity.postprocessHash) ||
          !/^.+;backend=.+;sha256=[a-f0-9]{64}$/i.test(qualificationIdentity.runtimeBackend || '')) {
        throw new Error('UltraMatte returned an incomplete canonical pipeline identity: ' + JSON.stringify(qualificationIdentity));
      }
      if (V.ortSource !== 'local') {
        throw new Error('UltraMatte identity test requires the bundled local ONNX Runtime; observed ' + String(V.ortSource));
      }

      const samples = [], hybridFrames = [];
      let preview = null;
      const waitForNextVideoFrame = () => new Promise((resolve, reject) => {
        if (typeof video.requestVideoFrameCallback !== 'function') {
          setTimeout(resolve, 100);
          return;
        }
        const timer = setTimeout(() => reject(new Error('Synthetic camera stopped delivering frames')), 5000);
        video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
      });
      for (let frame = 0; frame < 10; frame++) {
        // Advance the synthetic camera between inferences; do not benchmark
        // repeated snapshots of the same decoded frame.
        await waitForNextVideoFrame();
        // Capture the source immediately before inference so the saved visual
        // comparison is paired with the exact input frame used by the provider.
        const sourceFrame = document.createElement('canvas');
        sourceFrame.width = video.videoWidth; sourceFrame.height = video.videoHeight;
        sourceFrame.getContext('2d').drawImage(video, 0, 0);
        // Mirror app.js captureSegmentationFrame(): the model, tracker and
        // renderer must consume this one immutable frame, not the live camera
        // which may advance while inference is awaiting its worker.
        Object.defineProperties(sourceFrame, {
          videoWidth: { configurable: true, value: sourceFrame.width },
          videoHeight: { configurable: true, value: sourceFrame.height },
          __vsSegmentationFrame: { configurable: true, value: true }
        });
        const t0 = performance.now();
        const output = await Promise.race([
          provider.segment(sourceFrame),
          new Promise((_, reject) => setTimeout(() => reject(new Error('UltraMatte frame ' + frame + ' timed out')), 120000))
        ]);
        const segmentMs = performance.now() - t0;
        const mask = output && output.segmentationMask;
        if (!mask || !(mask.width > 0 && mask.height > 0)) throw new Error('UltraMatte returned an invalid alpha image on frame ' + frame);

        // Exercise the same GPU guided-upsample + temporal + edge-colour
        // decontamination stage used by render-core.js, not a raw mask-only
        // canvas composite. This makes the saved cutout preview representative
        // of Genesis Studio's actual final foreground path.
        const renderedForeground = edgeMatte.process(sourceFrame, mask, sourceFrame.width, sourceFrame.height);
        if (!renderedForeground) throw new Error('Studio GLMatte returned no foreground on frame ' + frame);
        // The GLMatte canvas already owns a WebGL2 context; read it back by
        // drawing into a separate 2D canvas (a canvas cannot switch context types).
        const renderedReadback = document.createElement('canvas');
        renderedReadback.width = renderedForeground.width;
        renderedReadback.height = renderedForeground.height;
        const renderedReadbackCtx = renderedReadback.getContext('2d', { willReadFrequently: true });
        if (!renderedReadbackCtx) throw new Error('Could not create the GLMatte readback canvas context');
        renderedReadbackCtx.drawImage(renderedForeground, 0, 0);
        const renderedPixels = renderedReadbackCtx.getImageData(0, 0, renderedReadback.width, renderedReadback.height).data;
        const renderedQuality = scoreAlpha(renderedPixels, 3, gtFullRgba, 0, renderedReadback.width, renderedReadback.height);
        const softForeground = softEdgeMatte.process(sourceFrame, mask, sourceFrame.width, sourceFrame.height);
        if (!softForeground) throw new Error('Soft-edge A/B GLMatte returned no foreground on frame ' + frame);
        const softReadback = document.createElement('canvas');
        softReadback.width = softForeground.width;
        softReadback.height = softForeground.height;
        const softReadbackCtx = softReadback.getContext('2d', { willReadFrequently: true });
        if (!softReadbackCtx) throw new Error('Could not create soft-edge A/B readback canvas');
        softReadbackCtx.drawImage(softForeground, 0, 0);
        const softPixels = softReadbackCtx.getImageData(0, 0, softReadback.width, softReadback.height).data;
        const softQuality = scoreAlpha(softPixels, 3, gtFullRgba, 0, softReadback.width, softReadback.height);
        const featherForeground = featherEdgeMatte.process(sourceFrame, mask, sourceFrame.width, sourceFrame.height);
        if (!featherForeground) throw new Error('Feather-edge A/B GLMatte returned no foreground on frame ' + frame);
        const featherReadback = document.createElement('canvas');
        featherReadback.width = featherForeground.width;
        featherReadback.height = featherForeground.height;
        const featherReadbackCtx = featherReadback.getContext('2d', { willReadFrequently: true });
        if (!featherReadbackCtx) throw new Error('Could not create feather-edge A/B readback canvas');
        featherReadbackCtx.drawImage(featherForeground, 0, 0);
        const featherPixels = featherReadbackCtx.getImageData(0, 0, featherReadback.width, featherReadback.height).data;
        const featherQuality = scoreAlpha(featherPixels, 3, gtFullRgba, 0, featherReadback.width, featherReadback.height);
        let renderedForegroundCount = 0, renderedSoftCount = 0;
        for (let i = 0; i < renderedPixels.length; i += 4) {
          const alpha = renderedPixels[i + 3];
          if (alpha > 16) renderedForegroundCount++;
          if (alpha > 8 && alpha < 247) renderedSoftCount++;
        }
        const renderedPixelCount = renderedPixels.length / 4;
        const renderedForegroundRatio = renderedForegroundCount / renderedPixelCount;
        if (renderedForegroundRatio < 0.01 || renderedForegroundRatio > 0.98) {
          throw new Error('Studio GLMatte returned an implausible foreground alpha: ' + renderedForegroundRatio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = mask.width; canvas.height = mask.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(mask, 0, 0);
        const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        // Resize the labelled alpha to the exact provider output size.
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(gtImage, 0, 0, canvas.width, canvas.height);
        const gtMaskRgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const rawQuality = scoreAlpha(rgba, 3, gtMaskRgba, 0, canvas.width, canvas.height);
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
        // Preserve visual evidence for review: source beside grayscale alpha,
        // plus a checkerboard composite. These are synthetic-camera previews,
        // not a substitute for consented real-person/hair test footage.
        const alphaCanvas = document.createElement('canvas');
        alphaCanvas.width = mask.width; alphaCanvas.height = mask.height;
        const alphaCtx = alphaCanvas.getContext('2d', { willReadFrequently: true });
        alphaCtx.drawImage(mask, 0, 0);
        const alphaImage = alphaCtx.getImageData(0, 0, mask.width, mask.height);
        for (let p = 0; p < alphaImage.data.length; p += 4) {
          const a = alphaImage.data[p + 3];
          alphaImage.data[p] = alphaImage.data[p + 1] = alphaImage.data[p + 2] = a;
          alphaImage.data[p + 3] = 255;
        }
        alphaCtx.putImageData(alphaImage, 0, 0);
        const comparison = document.createElement('canvas');
        comparison.width = mask.width * 2; comparison.height = mask.height;
        const comparisonCtx = comparison.getContext('2d');
        comparisonCtx.drawImage(sourceFrame, 0, 0, mask.width, mask.height);
        comparisonCtx.drawImage(alphaCanvas, mask.width, 0);
        const composite = document.createElement('canvas');
        composite.width = mask.width; composite.height = mask.height;
        const compositeCtx = composite.getContext('2d');
        const cell = 16;
        for (let y = 0; y < mask.height; y += cell) for (let x = 0; x < mask.width; x += cell) {
          compositeCtx.fillStyle = ((x / cell + y / cell) % 2) ? '#c8c8c8' : '#eeeeee';
          compositeCtx.fillRect(x, y, cell, cell);
        }
        compositeCtx.drawImage(renderedForeground, 0, 0, mask.width, mask.height);
        preview = { comparison: comparison.toDataURL('image/png'), composite: composite.toDataURL('image/png') };
        if (invalid) throw new Error('UltraMatte produced non-finite alpha values');
        if (foregroundRatio < 0.01 || foregroundRatio > 0.98) {
          throw new Error('UltraMatte returned an implausible empty/full mask: ' + foregroundRatio);
        }
        samples.push({
          frame, segmentMs: Math.round(segmentMs),
          width: mask.width, height: mask.height,
          foregroundRatio: +foregroundRatio.toFixed(4),
          softEdgeRatio: +(soft / pixels).toFixed(4),
          alphaMean: +(alphaSum / pixels / 255).toFixed(4),
          renderEdgeStage: {
            foregroundRatio: +renderedForegroundRatio.toFixed(4),
            softEdgeRatio: +(renderedSoftCount / renderedPixelCount).toFixed(4),
            outputWidth: renderedForeground.width,
            outputHeight: renderedForeground.height
          },
          syntheticGroundTruth: {
            rawMatte: rawQuality,
            studioMatte: renderedQuality,
            edgeThresholdExperiment: {
              parameters: { edgeLo: 0.15, edgeHi: 0.85 },
              studioMatte: softQuality
            },
            featherEdgeExperiment: {
              parameters: { edgeLo: 0.05, edgeHi: 0.95 },
              studioMatte: featherQuality
            }
          }
        });
        const frameHybrid = provider.hy || {};
        hybridFrames.push({
          frame, tiles: frameHybrid.tiles || 0, budget: frameHybrid.budget || 0,
          attempted: frameHybrid.attempted || 0, deferred: frameHybrid.deferred || 0, refined: frameHybrid.refined || 0, cached: frameHybrid.cached || 0,
          rejected: frameHybrid.rejected || 0, bandPct: frameHybrid.bandPct || 0,
          errors: frameHybrid.errors || 0, snapshotFailures: frameHybrid.snapshotFailures || 0
        });
      }

      if (samples.length !== 10) throw new Error('UltraMatte sustained gate expected 10 sequential frames but observed ' + samples.length);
      const timings = samples.map((sample) => sample.segmentMs).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
      const percentile = (values, p) => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : 0;
      const p75 = percentile(timings, 0.75);
      const performanceMetrics = {
        frameCount: samples.length,
        p50SegmentMs: percentile(timings, 0.50),
        p75SegmentMs: p75,
        p95SegmentMs: percentile(timings, 0.95),
        maxSegmentMs: timings.length ? timings[timings.length - 1] : 0,
        estimatedMaskUpdatesPerSecondAtP75: p75 > 0 ? +(1000 / p75).toFixed(2) : 0
      };
      const hybrid = provider.hy || {};
      const edge = provider.edgetam || {};
      provider.dispose();
      stream.getTracks().forEach((track) => track.stop());
      return {
        label: provider.label,
        ortSource: V.ortSource || 'unknown',
        ortVersion: ort.env && ort.env.versions ? ort.env.versions.web : 'unknown',
        qualificationIdentity: {
          modelVersion: qualificationIdentity.modelVersion,
          modelSha256: qualificationIdentity.modelSha256,
          preprocessHash: qualificationIdentity.preprocessHash,
          postprocessHash: qualificationIdentity.postprocessHash,
          runtimeBackend: qualificationIdentity.runtimeBackend
        },
        initMs: Math.round(initMs),
        performance: performanceMetrics,
        syntheticGroundTruth: {
          source: 'tools/e2e/fixtures/gt_alpha_640x480.png',
          scope: 'synthetic labelled fixture only; not real-person accuracy evidence'
        },
        samples,
        hybridFrames,
        preview,
        hybrid: {
          tiles: hybrid.tiles || 0, budget: hybrid.budget || 0,
          attempted: hybrid.attempted || 0, deferred: hybrid.deferred || 0, refined: hybrid.refined || 0, rejected: hybrid.rejected || 0,
          bandPct: hybrid.bandPct || 0, size: hybrid.size || null,
          errors: hybrid.errors || 0, snapshotFailures: hybrid.snapshotFailures || 0
        },
        renderMatte: {
          active: !!edgeMatte.ok,
          error: edgeMatte.error || null,
          effectiveEdgeThresholds: V.GLMatte.resolveEdgeThresholds(512, 384, edgeMatte.edgeLo, edgeMatte.edgeHi, edgeMatte.edgeProfile),
          edgeThresholdExperiment: {
            active: !!softEdgeMatte.ok,
            parameters: { edgeLo: 0.15, edgeHi: 0.85 },
            featherExperiment: { active: !!featherEdgeMatte.ok, parameters: { edgeLo: 0.05, edgeHi: 0.95 } }
          }
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
    if (!result.hybridFrames.every((frame) => frame.attempted <= frame.budget && frame.attempted === frame.refined + frame.rejected)) {
      throw new Error('UltraMatte exceeded its inference budget or failed to account for attempted tiles: ' + JSON.stringify(result.hybridFrames));
    }
    if (!result.hybridFrames.some((frame) => frame.tiles > 0 && frame.budget > 0 && frame.refined > 0)) {
      throw new Error('UltraMatte passed without executing high-resolution tile refinement on either camera frame: ' + JSON.stringify(result.hybridFrames));
    }
    if (!result.renderMatte || !result.renderMatte.active) throw new Error('Studio GLMatte final edge/decontamination stage was not active: ' + JSON.stringify(result.renderMatte));
    if (result.edgeTam.status !== 'ready') throw new Error('EdgeTAM status is not ready: ' + JSON.stringify(result.edgeTam));
    if (!result.edgeTam.gateActive) throw new Error('EdgeTAM did not produce an active subject gate: ' + JSON.stringify(result.edgeTam));
    if (!pageErrors.length) {
      console.log('PASS actual PP-MattingV2 + EdgeTAM/Hybrid browser inference');
    } else {
      throw new Error('Browser page errors: ' + pageErrors.join(' | '));
    }

    const preview = result.preview;
    delete result.preview;
    if (preview) {
      fs.writeFileSync(path.join(ROOT, 'ultramatte_last_comparison.png'), Buffer.from(preview.comparison.split(',')[1], 'base64'));
      fs.writeFileSync(path.join(ROOT, 'ultramatte_last_composite.png'), Buffer.from(preview.composite.split(',')[1], 'base64'));
    }
    fs.writeFileSync(REPORT, JSON.stringify({ pass: true, ...result, pageErrors }, null, 2));
    console.log('ULTRAMATTE_REPORT ' + JSON.stringify(result));
    console.log('PASS UltraMatte returned non-empty alpha on ' + result.performance.frameCount + ' sequential camera frames');
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
