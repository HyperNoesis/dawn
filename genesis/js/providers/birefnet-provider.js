/**
 * BiRefNet-lite matting provider (MIT licence). Best edges of the shippable models, but it is a 1024x1024 network:
 * it needs WebGPU and a desktop-class GPU for live use. On phones use it for stills/exports, not the live preview.
 * Same contract as the other providers: initialize(qualityMode), segment(video) -> { segmentationMask: canvas }, dispose(), label.
 * Output is a full-frame canvas (white RGB, matte in alpha), aspect-matched to the camera, smoothed over time by TemporalMask.
 */
(function (root) {
  'use strict';
  const V = root.VS = root.VS || {};
  const Base = V.MODNetSegmentationProvider || class {};
  const MODEL_ID = 'birefnet-lite';
  const OUT_LONG = 512;                       // matte long edge handed to the renderer (the net itself runs at 1024)

  /** Probabilities from raw model output. BiRefNet exports give logits; some wrappers already apply sigmoid. */
  function toProb(data, i) { const v = data[i]; return v < 0 || v > 1 ? 1 / (1 + Math.exp(-v)) : v; }
  function looksLikeLogits(data) { let lo = Infinity, hi = -Infinity; const step = Math.max(1, (data.length / 2048) | 0); for (let i = 0; i < data.length; i += step) { const v = data[i]; if (v < lo) lo = v; if (v > hi) hi = v; } return lo < 0 || hi > 1; }

  /** 1024x1024 model output -> Uint8 alpha of ow x oh (bilinear), in place into `dst`. */
  function resampleAlpha(data, srcN, ow, oh, logits, dst) {
    const sx = (srcN - 1) / Math.max(1, ow - 1), sy = (srcN - 1) / Math.max(1, oh - 1);
    for (let y = 0; y < oh; y++) {
      const fy = y * sy, y0 = fy | 0, y1 = Math.min(srcN - 1, y0 + 1), wy = fy - y0;
      for (let x = 0; x < ow; x++) {
        const fx = x * sx, x0 = fx | 0, x1 = Math.min(srcN - 1, x0 + 1), wx = fx - x0;
        const g = (yy, xx) => { const v = data[yy * srcN + xx]; return logits ? 1 / (1 + Math.exp(-v)) : v; };
        const p = g(y0, x0) * (1 - wx) * (1 - wy) + g(y0, x1) * wx * (1 - wy) + g(y1, x0) * (1 - wx) * wy + g(y1, x1) * wx * wy;
        dst[y * ow + x] = p <= 0 ? 0 : p >= 1 ? 255 : (p * 255 + 0.5) | 0;
      }
    }
    return dst;
  }

  /** v0.94 aspect fix. Where a WxH camera frame sits inside the square 1024 network input when its aspect ratio is kept (letterbox).
   *  Returns { dx, dy, dw, dh } in network pixels. 'stretch' (the v0.93 behaviour) fills the whole square. */
  function fitRect(vw, vh, N, mode) {
    if (mode === 'stretch' || !(vw > 0 && vh > 0)) return { dx: 0, dy: 0, dw: N, dh: N };
    const s = Math.min(N / vw, N / vh), dw = Math.max(1, Math.round(vw * s)), dh = Math.max(1, Math.round(vh * s));
    return { dx: Math.floor((N - dw) / 2), dy: Math.floor((N - dh) / 2), dw, dh };
  }
  /** Like resampleAlpha, but reads only the sub-rectangle `r` of the srcN x srcN output (the letterboxed picture), so the matte lines up with the camera frame. */
  function resampleAlphaRect(data, srcN, r, ow, oh, logits, dst) {
    const sx = (r.dw - 1) / Math.max(1, ow - 1), sy = (r.dh - 1) / Math.max(1, oh - 1);
    const g = (yy, xx) => { const v = data[(r.dy + yy) * srcN + (r.dx + xx)]; return logits ? 1 / (1 + Math.exp(-v)) : v; };
    for (let y = 0; y < oh; y++) {
      const fy = y * sy, y0 = fy | 0, y1 = Math.min(r.dh - 1, y0 + 1), wy = fy - y0;
      for (let x = 0; x < ow; x++) {
        const fx = x * sx, x0 = fx | 0, x1 = Math.min(r.dw - 1, x0 + 1), wx = fx - x0;
        const p = g(y0, x0) * (1 - wx) * (1 - wy) + g(y0, x1) * wx * (1 - wy) + g(y1, x0) * (1 - wx) * wy + g(y1, x1) * wx * wy;
        dst[y * ow + x] = p <= 0 ? 0 : p >= 1 ? 255 : (p * 255 + 0.5) | 0;
      }
    }
    return dst;
  }
  function fitMode() { try { return localStorage.getItem('vs_birefnet_fit') === 'stretch' ? 'stretch' : 'letterbox'; } catch (e) { return 'letterbox'; } }

  class BiRefNetSegmentationProvider extends Base {
    constructor() {
      super();
      this.label = 'BiRefNet lite (local, MIT)';
      this.longEdge = 0;                      // fixed 1024 network: the app's resolution ladder does not apply
      this.costPerFrame = 0;
      this.temporal = true;
      this.onProgress = null;
      this._px = null; this._fused = null;
    }
    static isSupported() { return typeof navigator !== 'undefined' && !!navigator.gpu; }

    async initialize(qualityMode, opts) {
      const force = (() => { try { return localStorage.getItem('vs_force_heavy') === '1'; } catch (e) { return false; } })();
      if (!BiRefNetSegmentationProvider.isSupported() && !force) throw new Error('BiRefNet needs WebGPU (this browser has none).');
      try { await V.loadOrt(); } catch (e) { /* reported below */ }
      if (typeof ort === 'undefined') throw new Error('onnxruntime-web failed to load.');
      const o = opts || {};
      const { bytes } = await V.ModelStore.load(MODEL_ID, { onProgress: (f, l) => { if (this.onProgress) this.onProgress(f, l); if (o.onProgress) o.onProgress(f, l); } });
      const model = bytes['birefnet_lite_fp16.onnx'];
      this.session = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
      this.usingWebGPU = true;
      this._inName = (this.session.inputNames && this.session.inputNames[0]) || 'input_image';
      this._outName = (this.session.outputNames && this.session.outputNames[0]) || 'output_image';
      this._inCanvas = document.createElement('canvas'); this._inCanvas.width = this._inCanvas.height = 1024;
      this._inCtx = this._inCanvas.getContext('2d', { willReadFrequently: true });
      this._outCanvas = document.createElement('canvas'); this._outCtx = this._outCanvas.getContext('2d');
      this._px = new Float32Array(3 * 1024 * 1024);
      this.label = 'BiRefNet lite (local, MIT, WebGPU)';
    }

    async segment(video) {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) throw new Error('Video has no dimensions yet');
      const ow = vw >= vh ? OUT_LONG : Math.max(2, Math.round(OUT_LONG * vw / vh)), oh = vw >= vh ? Math.max(2, Math.round(OUT_LONG * vh / vw)) : OUT_LONG;
      const fit = fitRect(vw, vh, 1024, fitMode());                           // v0.94: keep the camera's aspect ratio (letterbox); vs_birefnet_fit = stretch restores the v0.93 squash
      if (fit.dw !== 1024 || fit.dh !== 1024) { this._inCtx.fillStyle = 'rgb(124,116,104)'; this._inCtx.fillRect(0, 0, 1024, 1024); }   // ImageNet mean colour: normalises to ~0
      this._inCtx.drawImage(video, 0, 0, vw, vh, fit.dx, fit.dy, fit.dw, fit.dh);
      const rgba = this._inCtx.getImageData(0, 0, 1024, 1024).data;
      const C = V.EdgeTAMCore;                                               // shared ImageNet preprocessing
      C.toPixelValues(rgba, 1024, this._px);
      const out = await this.session.run({ [this._inName]: new ort.Tensor('float32', this._px, [1, 3, 1024, 1024]) });
      const t = out[this._outName] || out[Object.keys(out)[0]];
      const n = ow * oh;
      let alpha = fit.dw === 1024 && fit.dh === 1024 ? resampleAlpha(t.data, 1024, ow, oh, looksLikeLogits(t.data), new Uint8Array(n)) : resampleAlphaRect(t.data, 1024, fit, ow, oh, looksLikeLogits(t.data), new Uint8Array(n));
      if (this.temporal) { alpha = V.TemporalMask.fuse(this._fused && this._fused.length === n ? this._fused : null, alpha); this._fused = alpha; }
      if (this._outCanvas.width !== ow || this._outCanvas.height !== oh) { this._outCanvas.width = ow; this._outCanvas.height = oh; this._img = null; }
      if (!this._img) this._img = this._outCtx.createImageData(ow, oh);
      const d = this._img.data;
      for (let i = 0, j = 0; i < n; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = alpha[i]; }
      this._outCtx.putImageData(this._img, 0, 0);
      return { segmentationMask: this._outCanvas };
    }

    dispose() { try { if (this.session && this.session.release) this.session.release(); } catch (e) { /* ignore */ } this.session = null; this._px = null; this._fused = null; }
  }

  BiRefNetSegmentationProvider.core = { resampleAlpha, resampleAlphaRect, fitRect, looksLikeLogits, toProb };
  if (typeof module !== 'undefined' && module.exports) module.exports = BiRefNetSegmentationProvider;
  V.BiRefNetSegmentationProvider = BiRefNetSegmentationProvider;
})(typeof window !== 'undefined' ? window : globalThis);
