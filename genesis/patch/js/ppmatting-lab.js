/* Genesis matting lab (v0.94). Dev/benchmark page: runs PP-Matting engines on a still, a video file or the camera,
 * shows raw vs refined mattes, measures the WHOLE pipeline (draw + model + refine + paint), optional ground-truth metrics,
 * and builds the report that VS.EnginePolicy.evaluateGate() judges. window.__lab exposes the same functions for automated tests. */
(function () {
  'use strict';
  const V = window.VS, $ = (id) => document.getElementById(id), M = V.MattingMetrics, C = V.PPMattingCore;
  const st = { src: null, srcKind: null, provider: null, exporter: null, running: false, gt: null, last: null,
    times: [], modelMs: [], rawSeq: [], refSeq: [], lumaSeq: [], startMem: null, stats: {}, deviceTier: null, uploads: false };

  const status = (t) => { $('status').textContent = t; };
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d == null ? 1 : d) : '–');

  function drawGray(canvas, a, w, h) {
    canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d'), img = ctx.createImageData(w, h);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) { img.data[j] = img.data[j + 1] = img.data[j + 2] = a[i]; img.data[j + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  }
  function drawSrc(src) { const w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height; $('cSrc').width = w; $('cSrc').height = h; $('cSrc').getContext('2d').drawImage(src, 0, 0, w, h); }

  function device() {
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
    return { mobile, cores: navigator.hardwareConcurrency || null, memGB: navigator.deviceMemory || null, webgpu: !!navigator.gpu, ua: navigator.userAgent };
  }

  function renderMetrics(extra) {
    const L = M.latency(st.times), LM = M.latency(st.modelMs);
    const rows = [['Engine', st.provider ? st.provider.label : (st.exporter ? st.exporter.title : '–')], ['Device tier', V.EnginePolicy.tier(device())],
      ['Frames', L.n], ['FPS (whole pipeline)', num(L.fps)], ['Frame p50 / p95 / max (ms)', num(L.p50) + ' / ' + num(L.p95) + ' / ' + num(L.max)], ['Model only, p50 / p95 (ms)', num(LM.p50) + ' / ' + num(LM.p95)]];
    if (st.stats.flickerRaw != null) rows.push(['Flicker raw → refined (lower is better)', num(st.stats.flickerRaw, 3) + ' → ' + num(st.stats.flickerRef, 3) + (st.stats.flickerRatio != null ? ' (ratio ' + num(st.stats.flickerRatio, 2) + ')' : '')]);
    if (st.stats.coverage != null) rows.push(['Matte coverage', num(st.stats.coverage * 100) + ' %']);
    if (st.stats.gt) rows.push(['vs ground truth (raw): SAD / MAD / grad', num(st.stats.gt.sad, 2) + ' / ' + num(st.stats.gt.mad, 2) + ' / ' + num(st.stats.gt.grad, 3)]);
    if (st.stats.memGrowthMB != null) rows.push(['JS heap growth (MB)', num(st.stats.memGrowthMB)]);
    for (const e of (extra || [])) rows.push(e);
    $('metrics').innerHTML = rows.map((r) => '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>').join('');
  }

  function heap() { return performance && performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null; }

  /** The shipped MODNet engine behind the same interface the lab uses (lastRaw / lastSize / lastMs). This is the BASELINE the brief says to record first. */
  class ModnetBaseline {
    constructor() { this.p = new V.MODNetWorkerProvider(); this.p.useRoi = false; this.title = 'MODNet'; this.label = 'MODNet (baseline)'; this.usingWebGPU = false; this.lastRaw = null; this.lastRefined = null; this.lastSize = [0, 0]; this.lastMs = 0; }
    static isSupported() { return !!V.MODNetWorkerProvider && (V.MODNetWorkerProvider.isSupported ? V.MODNetWorkerProvider.isSupported() : true); }
    set onProgress(f) { this.p.onProgress = f; }
    async initialize(q) { await this.p.initialize(q); this.label = (this.p.label || 'MODNet') + ' (baseline)'; }
    async segment(src) {
      const t = performance.now(), r = await this.p.segment(src); this.lastMs = performance.now() - t;
      const mc = r.segmentationMask, w = mc.width, h = mc.height; if (!this._c || this._c.width !== w || this._c.height !== h) { this._c = document.createElement('canvas'); this._c.width = w; this._c.height = h; this._x = this._c.getContext('2d', { willReadFrequently: true }); }
      this._x.clearRect(0, 0, w, h); this._x.drawImage(mc, 0, 0); const d = this._x.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h); for (let k = 0; k < a.length; k++) a[k] = d[k * 4 + 3];
      this.lastRaw = a; this.lastSize = [w, h]; return r;
    }
    resetTemporal() { try { this.p.resetTemporal && this.p.resetTemporal(); } catch (e) { /* ignore */ } }
    dispose() { try { this.p.dispose && this.p.dispose(); } catch (e) { /* ignore */ } }
  }

  async function makeProvider() {
    if (st.provider) { try { st.provider.dispose(); } catch (e) { /* ignore */ } st.provider = null; }
    const id = $('engine').value, P = id === 'modnet' ? ModnetBaseline : id === 'ppmatting-hrnet' ? V.PPMattingHRNetProvider : V.PPMattingV2Provider;
    if (!P.isSupported()) throw new Error('This browser cannot run workers/WebAssembly.');
    { const bv = $('backend').value; try { if (bv === 'wasm') localStorage.setItem('vs_webgpu', '0'); else if (bv === 'webgpu') localStorage.setItem('vs_webgpu', '1'); else localStorage.removeItem('vs_webgpu'); } catch (e) { /* ignore */ } }   // v0.98: 'webgpu' forces WebGPU on phones (the app default keeps phones on WASM)
    const p = new P(); p.onProgress = (f) => status('Loading model… ' + Math.round(f * 100) + ' %');
    await p.initialize($('quality').value);
    st.provider = p; return p;
  }

  async function matteStillModnet(src) {
    const p = st.provider && st.provider instanceof ModnetBaseline ? st.provider : await makeProvider();
    const w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height, c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(src, 0, 0, w, h); c.videoWidth = w; c.videoHeight = h;
    drawSrc(src); await p.segment(c); const t0 = performance.now(); await p.segment(c); const total = performance.now() - t0;   // first call warms the worker, second is timed
    const [ow, oh] = p.lastSize, a = p.lastRaw; st.times = [total]; st.modelMs = [p.lastMs]; st.last = { alpha: a, w: ow, h: oh, netSize: [ow, oh], ms: p.lastMs };
    drawGray($('cRaw'), a, ow, oh); drawGray($('cRef'), a, ow, oh); st.stats.coverage = C.coverage(a); await gtCompare(a, ow, oh); recordRun('still'); renderMetrics([['Baseline', 'MODNet at its shipped size']]); status('Baseline done in ' + Math.round(total) + ' ms.');
    return { ms: total, modelMs: p.lastMs, coverage: st.stats.coverage, size: [ow, oh] };
  }

  /** Keep the latest result per engine so the report can compare PP-MattingV2 with the MODNet baseline on the SAME source. */
  function recordRun(kind) {
    const L = M.latency(st.times), id = $('engine').value;
    st.runs = st.runs || {}; st.runs[id] = Object.assign(st.runs[id] || {}, { kind, fps: L.fps, p50: L.p50, p95: L.p95, frames: L.n, gt: st.stats.gt || null, coverage: st.stats.coverage, flickerRaw: st.stats.flickerRaw, guard: st.guardCounts || null });
  }

  async function matteStill(src) {
    if ($('engine').value === 'modnet') return matteStillModnet(src);
    if (st.exporter) { st.exporter.dispose(); st.exporter = null; }
    status('Loading model…');
    st.exporter = await V.PPMattingExport.create({ model: $('engine').value, webgpu: $('backend').value !== 'wasm', onProgress: (f) => status('Loading model… ' + Math.round(f * 100) + ' %') });
    drawSrc(src);
    const t0 = performance.now(), r = await st.exporter.matte(src), total = performance.now() - t0;
    st.times = [total]; st.modelMs = [r.ms]; st.last = r;
    drawGray($('cRaw'), r.alpha, r.w, r.h); drawGray($('cRef'), r.alpha, r.w, r.h);
    const cut = st.exporter.cutout(src, r); $('cCut').width = r.w; $('cCut').height = r.h; $('cCut').getContext('2d').drawImage(cut, 0, 0); $('dl').disabled = false;
    st.stats.coverage = C.coverage(r.alpha);
    await gtCompare(r.alpha, r.w, r.h); recordRun('still');
    renderMetrics([['Network size', r.netSize.join(' × ') + ' (source ' + r.w + ' × ' + r.h + ')'], ['Backend', st.exporter.usingWebGPU ? 'WebGPU' : 'WASM']]);
    status('Done in ' + Math.round(total) + ' ms (model ' + Math.round(r.ms) + ' ms).');
    return { ms: total, modelMs: r.ms, coverage: st.stats.coverage, size: [r.w, r.h], netSize: r.netSize, alphaSum: r.alpha.reduce((s, v) => s + v, 0) };
  }

  async function gtCompare(alpha, w, h) {
    if (!st.gt) { delete st.stats.gt; return; }
    const g = st.gt, gA = g.w === w && g.h === h ? g.a : C.resizeAlpha(g.a, g.w, g.h, w, h);
    const e = M.errors(alpha, gA); st.stats.gt = { sad: e.sad, mad: e.mad, grad: M.gradientError(alpha, gA, w, h) };
  }

  /** Live loop over a <video> element (camera or file). frames = max frames (0 = until stop). Returns the summary. */
  async function live(video, frames) {
    const p = st.provider || await makeProvider();
    st.running = true; st.times = []; st.modelMs = []; st.rawSeq = []; st.refSeq = []; st.lumaSeq = []; st.startMem = heap(); st.guardCounts = { sceneCuts: 0, lostEpisodes: 0, recoveries: 0, heldFrames: 0, occludedFrames: 0 }; p.resetTemporal();
    const luma = document.createElement('canvas'); luma.width = 48; luma.height = 27; const lctx = luma.getContext('2d', { willReadFrequently: true });
    let n = 0, failures = 0, black = 0;
    while (st.running && (!frames || n < frames)) {
      const t0 = performance.now();
      try {
        const r = await p.segment(video);
        const g = p.lastGuard; if (g) { const gc = st.guardCounts; if (g.sceneCut) gc.sceneCuts++; if (g.useHeld) gc.heldFrames++; if (g.state === 'occluded') gc.occludedFrames++; for (const why of g.reasons) { if (why === 'subject lost') gc.lostEpisodes++; if (why === 'recovered') gc.recoveries++; } }
        const [ow, oh] = p.lastSize;
        const raw = p.lastRaw, ref = p.lastRefined || p.lastRaw;
        st.times.push(performance.now() - t0); st.modelMs.push(p.lastMs);
        if (C.coverage(raw) < 0.0005) black++;                      // an empty matte on a live frame counts as a suspicious (black) frame
        if (st.rawSeq.length < 120) { st.rawSeq.push(Uint8Array.from(raw)); st.refSeq.push(Uint8Array.from(ref)); lctx.drawImage(video, 0, 0, 48, 27); const d = lctx.getImageData(0, 0, 48, 27).data, y = new Uint8Array(48 * 27); for (let i = 0; i < y.length; i++) y[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) | 0; st.lumaSeq.push(y); }
        if (n % 5 === 0) { drawSrc(video); drawGray($('cRaw'), raw, ow, oh); drawGray($('cRef'), ref, ow, oh); }
        st.stats.coverage = C.coverage(raw);
      } catch (e) { failures++; status('Frame error: ' + e.message); if (failures > 5) break; }
      n++;
      if (video.paused || video.ended) { if (video.ended) break; }
      await new Promise((r) => requestAnimationFrame(r));
    }
    st.running = false;
    const sm = summarise(n, failures, black); recordRun('live'); sm.guard = st.guardCounts; return sm;
  }

  function summarise(n, failures, black) {
    // flicker on the model-size planes: luma sequence is 48x27, matte is larger, so compare matte-to-matte over time restricted by block-mean luma motion
    const lumaUp = st.lumaSeq.length ? st.lumaSeq : null;
    let fr = null, ff = null;
    if (st.rawSeq.length > 2) {
      const [w, h] = st.provider.lastSize, lu = lumaUp.map((l) => C.resizeAlpha(l, 48, 27, w, h));
      fr = M.flicker(st.rawSeq, lu, 6); ff = M.flicker(st.refSeq, lu, 6);
    }
    st.stats.flickerRaw = fr; st.stats.flickerRef = ff; st.stats.flickerRatio = fr ? ff / fr : null;
    const h1 = heap(); st.stats.memGrowthMB = h1 != null && st.startMem != null ? h1 - st.startMem : null;
    st.stats.frames = n; st.stats.failures = failures; st.stats.blackFrames = black;
    renderMetrics(); const L = M.latency(st.times);
    status('Stopped after ' + n + ' frames.');
    if (V.EnginePolicy && V.EnginePolicy.recordMeasured) V.EnginePolicy.recordMeasured($('engine').value, L.p95, n);   // v0.95: the router learns this device's real speed
    return { frames: n, failures, blackFrames: black, fps: L.fps, p50: L.p50, p95: L.p95, flickerRaw: fr, flickerRef: ff, flickerRatio: st.stats.flickerRatio, coverage: st.stats.coverage };
  }

  function buildReport() {
    const L = M.latency(st.times), s = st.stats, d = device();
    const report = { engine: $('engine').value, quality: $('quality').value, device: d, tier: V.EnginePolicy.tier(d), backend: st.provider ? (st.provider.usingWebGPU ? 'webgpu' : 'wasm') : null,
      fps: L.n >= 30 ? L.fps : undefined, p95Ms: L.n >= 30 ? L.p95 : undefined, flickerRatio: s.flickerRatio != null ? s.flickerRatio : undefined,
      sadRatio: undefined, gradRatio: undefined, memGrowthMB: s.memGrowthMB != null ? s.memGrowthMB : undefined,
      sessionMinutes: L.n ? (st.times.reduce((a, b) => a + b, 0) / 60000) : undefined, recoveryFailures: s.failures, blackFrames: s.blackFrames, uploadsFrames: st.uploads,
      frames: L.n, gt: s.gt || null, runs: st.runs || {}, guard: st.guardCounts || null, manual: { hairFingers: $('mHair').checked || undefined, realDevice: $('mDev').checked || undefined, licenceReviewed: $('mLic').checked || undefined } };
    // Ratios against the MODNet baseline on the SAME source (needs a ground-truth alpha and a baseline still run). <= 1.0 means PP-MattingV2 is at least as good.
    const b = st.runs && st.runs.modnet && st.runs.modnet.gt, pp = st.runs && st.runs['ppmatting-v2'] && st.runs['ppmatting-v2'].gt;
    if (b && pp && b.sad > 0 && b.grad > 0) { report.sadRatio = pp.sad / b.sad; report.gradRatio = pp.grad / b.grad; }
    return report;
  }
  function showGate() {
    const r = buildReport(), g = V.EnginePolicy.evaluateGate(r);
    $('report').textContent = JSON.stringify(r, null, 1);
    $('gate').innerHTML = Object.keys(g.gates).map((k) => '<tr><th>' + k + '</th><td class="' + g.gates[k] + '">' + g.gates[k] + '</td></tr>').join('') +
      '<tr><th>Result</th><td class="' + (g.pass ? 'pass' : 'fail') + '">' + (g.pass ? 'ALL GATES PASS' : 'NOT READY: stays beta, default engine unchanged') + '</td></tr>';
    return g;
  }

  async function loadImage(file) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
  function loadVideo(file) { return new Promise((res, rej) => { const v = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true; v.onloadeddata = () => res(v); v.onerror = rej; v.src = URL.createObjectURL(file); }); }

  $('file').addEventListener('change', async () => {
    const f = $('file').files[0]; if (!f) return;
    try {
      if (f.type.startsWith('video/')) { st.src = await loadVideo(f); st.srcKind = 'video'; $('startVid').disabled = false; $('runStill').disabled = true; }
      else { st.src = await loadImage(f); st.srcKind = 'image'; $('runStill').disabled = false; $('startVid').disabled = true; drawSrc(st.src); }
      status('Source ready.');
    } catch (e) { status('Could not read that file.'); }
  });
  $('gtFile').addEventListener('change', async () => {
    const f = $('gtFile').files[0]; if (!f) { st.gt = null; return; }
    const i = await loadImage(f), c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; const x = c.getContext('2d'); x.drawImage(i, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data, a = new Uint8Array(c.width * c.height);
    const hasAlpha = (() => { for (let k = 3; k < d.length; k += 4) if (d[k] !== 255) return true; return false; })();
    for (let k = 0; k < a.length; k++) a[k] = hasAlpha ? d[k * 4 + 3] : d[k * 4];       // RGBA cutout: use its alpha; grey image: use luminance
    st.gt = { a, w: c.width, h: c.height }; status('Ground-truth alpha loaded.');
  });
  $('runStill').addEventListener('click', async () => { try { await matteStill(st.src); } catch (e) { status('Error: ' + e.message); } });
  $('startVid').addEventListener('click', async () => { try { await st.src.play(); $('stop').disabled = false; await live(st.src, 0); showGate(); } catch (e) { status('Error: ' + e.message); } });
  $('startCam').addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = stream; await v.play(); $('stop').disabled = false;
      await live(v, 0); stream.getTracks().forEach((t) => t.stop()); showGate();
    } catch (e) { status('Camera error: ' + e.message); }
  });
  $('stop').addEventListener('click', () => { st.running = false; $('stop').disabled = true; });
  $('mkReport').addEventListener('click', showGate);
  $('dl').addEventListener('click', () => { $('cCut').toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'genesis-cutout.png'; a.click(); }); });
  for (const id of ['engine', 'backend', 'quality']) $(id).addEventListener('change', () => { if (st.provider) { st.provider.dispose(); st.provider = null; } });   // v0.98: a backend/quality change must rebuild the model, not reuse the old session

  window.__lab = { st, matteStill, live, makeProvider, buildReport, showGate, summarise };
  $('startCam').disabled = !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  status('Pick an image or a video file (or use the camera).');
  renderMetrics();
})();
