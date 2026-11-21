/**
 * PP-Matting providers (v0.94, BETA, behind a feature flag). Apache-2.0 (yakhyo/ppmatting inference code, PaddleSeg human_512 weights).
 *   PPMattingV2Provider    PP-MattingV2 STDC1, ~34 MiB, the commercial live-matting beta candidate.
 *   PPMattingHRNetProvider PP-Matting HRNet-W18, ~94 MiB, higher accuracy, desktop / export quality. NOT a live default.
 *
 * Same contract as the other Genesis providers: initialize(qualityMode, opts), segment(video) -> { segmentationMask: canvas }, dispose(), label.
 * Built on the existing MODNet provider (camera sizing, person-ROI crop, low-light boost, mask canvas hand-over), because both models take
 * the same input (RGB, mean 0.5 / std 0.5, sides multiple of 32) and return alpha in [0,1]. Only model loading, the worker and temporal refinement differ.
 *
 * Temporal modes (localStorage vs_ppm_temporal): 'refined' (default, TemporalMatte per-region smoothing) or 'raw' (model output untouched).
 * Both mattes are always kept: provider.lastRaw / provider.lastRefined (Uint8Array, provider.lastSize = [w,h]) for A/B review.
 *
 * Self-check: initialize() runs one synthetic frame through the model and records provider.selfCheck = { ms, ok }. A model that errors,
 * returns the wrong size or NaN is rejected, so the engine router falls back to the previous engine instead of showing black frames.
 */
(function (root) {
  'use strict';
  const V = root.VS = root.VS || {};
  // Subclass the ORIGINAL worker provider (the matte-engine router later replaces V.MODNetWorkerProvider with a function that would recurse).
  const Base = V.MatteEnginesOriginal || V.MODNetWorkerProvider || V.MODNetSegmentationProvider || class {};
  const QUALITY = { fast: 320, balanced: 384, quality: 512 };   // long edge of the matte the network sees; the models were trained with short side <= 512
  const TEMPORAL_KEY = 'vs_ppm_temporal';

  function mainOn() { try { return localStorage.getItem('vs_ppm_main') === '1'; } catch (e) { return false; } }
  function guardOn() { try { return localStorage.getItem('vs_ppm_guard') !== '0'; } catch (e) { return true; } }
  /** 32x18 grayscale thumbnail of the model input (box-sampled) for scene-cut detection. */
  function thumb(rgba, w, h, out) { const TW = 32, TH = 18; for (let ty = 0; ty < TH; ty++) { const y = Math.min(h - 1, Math.floor((ty + 0.5) * h / TH)); for (let tx = 0; tx < TW; tx++) { const x = Math.min(w - 1, Math.floor((tx + 0.5) * w / TW)), i = (y * w + x) * 4; out[ty * TW + tx] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8; } } return out; }
  function temporalMode() { try { return localStorage.getItem(TEMPORAL_KEY) === 'raw' ? 'raw' : 'refined'; } catch (e) { return 'refined'; } }

  class PPMattingBase extends Base {
    constructor(modelId, title, edges) {
      super();
      this.modelId = modelId; this.title = title; this.edges = edges || QUALITY;
      this.experimental = true;
      this.label = title + ' (beta, local, Apache-2.0)';
      this.costPerFrame = 0;
      this.lowLightBoost = false;                 // keep the input untouched so raw/refined comparisons are about the model
      // Person-ROI crop (roi-track.js) moves the matte's coordinate frame between frames, which would make temporal blending mix misaligned pixels.
      // Off by default for the beta (the model is light enough to see the full frame); localStorage vs_ppm_roi = 1 enables it and the temporal state resets whenever the crop changes.
      this.useRoi = (() => { try { return localStorage.getItem('vs_ppm_roi') === '1' && !!(root.VS && root.VS.RoiTrack); } catch (e) { return false; } })();
      this._lastRectKey = '';
      this.tm = null; this.lastRaw = null; this.lastRefined = null; this.lastSize = null; this.selfCheck = null; this.lastMs = 0;
    }
    static isSupported() { return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined'; }

    async initialize(qualityMode, opts) {
      opts = opts || {};
      this.longEdge = this.edges[qualityMode] || this.edges.balanced;
      if (!V.ModelStore) await V.loadScript('js/providers/model-store.js');
      if (!V.PPMattingCore) await V.loadScript('js/providers/ppmatting-core.js');
      if (!V.TemporalMatte) await V.loadScript('js/providers/temporal-matte.js');
      if (!V.MatteRefine) { try { await V.loadScript('js/providers/matte-refine.js'); } catch (e) { /* optional */ } }
      if (!V.VideoGuard) { try { await V.loadScript('js/providers/video-guard.js'); } catch (e) { /* guard is optional: without it the provider behaves as before */ } }
      const { bytes } = await V.ModelStore.load(this.modelId, { onProgress: (f, l) => { if (this.onProgress) this.onProgress(f, l); if (opts.onProgress) opts.onProgress(f, l); } });
      const file = Object.keys(bytes)[0], buf = bytes[file];
      const gpuWanted = typeof navigator !== 'undefined' && !!navigator.gpu && this._webgpuAllowed();
      const want = (opts.threads | 0) > 0 ? (opts.threads | 0) : (Base.threadsFor ? Base.threadsFor() : 1);
      const r = await this._boot('js/providers/ppmatting-worker.js', (base) => ({
        bytes: (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) ? buf.buffer : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), gpu: gpuWanted
      }), want);
      this.usingWebGPU = !!r.gpu; this.initNote = r.note || ''; this._ready = true;
      this.label = this.title + ' (beta, local, ' + (this.usingWebGPU ? 'WebGPU' : 'WASM' + (this.threads > 1 ? ' x' + this.threads : '')) + ')';
      this._mw = 0; this._mh = 0;
      this.tm = V.TemporalMatte.create();
      this.guard = V.VideoGuard && guardOn() ? V.VideoGuard.create() : null;   // scene cut / subject loss / recovery (video-guard.js); vs_ppm_guard = 0 turns it off
      await this._selfCheck();
    }

    /** WebGPU only where it is known to help (desktop). Phones stay on WASM unless localStorage vs_webgpu = 1, same rule as MODNet. */
    _webgpuAllowed() { return Base.webgpuAllowed ? Base.webgpuAllowed() : false; }

    /** Release gate #1 at start-up: one synthetic frame must come back the right size, finite and with a plausible spread. */
    async _selfCheck() {
      const w = 256, h = 192, rgba = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, inside = x > 80 && x < 176 && y > 30; rgba[i] = inside ? 200 : 40; rgba[i + 1] = inside ? 150 : 60; rgba[i + 2] = inside ? 120 : 90; rgba[i + 3] = 255; }
      const t0 = performance.now();
      const r = await this._send({ type: 'run', w, h, rgba: rgba.buffer.slice(0) });
      const ms = performance.now() - t0, a = new Uint8Array(r.alpha);
      const dimensionsOk = r.w === w && r.h === h && a.length === w * h;
      const alphaCoverage = V.PPMattingCore.coverage(a);
      // A finite, correctly shaped tensor can still be a dead model (all
      // foreground or all background). Reject only degenerate output here;
      // real scene quality remains the responsibility of the camera gates.
      const coverageOk = alphaCoverage > 0.001 && alphaCoverage < 0.999;
      const ok = dimensionsOk && coverageOk;
      this.selfCheck = { ms: Math.round(ms), ok, alphaCoverage: +alphaCoverage.toFixed(5), dimensionsOk, coverageOk };
      if (!dimensionsOk) throw new Error(this.title + ' self-check failed: unexpected output size ' + r.w + 'x' + r.h);
      if (!coverageOk) throw new Error(this.title + ' self-check failed: degenerate alpha coverage ' + alphaCoverage.toFixed(5));
    }

    async segment(video) {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) throw new Error('Video has no dimensions yet');
      if (!this._ready) throw new Error(this.title + ' worker not ready');
      this._configure(vw, vh);
      const rk = this._rect ? [this._rect.sx, this._rect.sy, this._rect.sw, this._rect.sh, this._mw, this._mh].join(',') : '';
      if (rk !== this._lastRectKey) { this._lastRectKey = rk; if (this.tm) this.tm.reset(); }   // crop or size changed: never blend across different coordinate frames
      const data = this._draw(video);
      const copy = new Uint8ClampedArray(data).buffer;
      const r = await this._send({ type: 'run', w: this._mw, h: this._mh, rgba: copy }, [copy]);
      this.lastMs = r.ms || 0;
      const ow = r.w, oh = r.h; let raw = new Uint8Array(r.alpha);
      if (mainOn() && V.MatteRefine) raw = V.MatteRefine.keepMainSubject(raw, ow, oh).alpha;   // v0.95 opt-in for live (localStorage vs_ppm_main = 1): drops stray blobs; default OFF until phone-tested
      let shown = raw, gd = null;
      if (this.guard) {
        if (!this._thumb) this._thumb = new Uint8Array(32 * 18);
        gd = this.guard.step({ alpha: raw, w: ow, h: oh, luma: thumb(data, this._mw, this._mh, this._thumb) });
        this.lastGuard = gd;
        if (gd.resetTemporal && this.tm) this.tm.reset();     // scene cut or subject recovered: old frames must not ghost into the new picture
      }
      if (gd && gd.useHeld && this.guard.held()) {            // subject lost: show the last good matte fading out, never a stuck or black frame
        const hd = this.guard.held(); shown = new Uint8Array(raw.length); for (let i = 0; i < shown.length; i++) shown[i] = (hd[i] * gd.fade + 0.5) | 0; this.lastRefined = null;
      } else if (temporalMode() === 'refined' && this.tm) { const s = this.tm.step(raw, ow, oh); shown = s.refined; this.lastRefined = Uint8Array.from(shown); }
      else { this.lastRefined = null; }
      this.lastRaw = raw; this.lastSize = [ow, oh];
      if (this._outCanvas.width !== ow || this._outCanvas.height !== oh || !this._outImageData) { this._outCanvas.width = ow; this._outCanvas.height = oh; this._outImageData = this._outCtx.createImageData(ow, oh); }
      const px = this._outImageData.data;
      for (let i = 0, n = ow * oh; i < n; i++) { const o = i * 4; px[o] = 255; px[o + 1] = 255; px[o + 2] = 255; px[o + 3] = shown[i]; }
      this._outCtx.putImageData(this._outImageData, 0, 0);
      return { segmentationMask: this._emit() };
    }

    /** Camera restart / orientation change: forget the temporal state so an old matte can never ghost onto a new frame. */
    resetTemporal() { if (this.tm) this.tm.reset(); if (this.guard) this.guard.reset(); }
    dispose() { super.dispose(); this.tm = null; this.lastRaw = this.lastRefined = null; }
  }

  class PPMattingV2Provider extends PPMattingBase {
    constructor() { super('ppmatting-v2', 'PP-MattingV2', QUALITY); }
  }
  class PPMattingHRNetProvider extends PPMattingBase {
    // Heavier network: smaller live budget. Not offered as a live default; see engine-policy.js (export / benchmark only until measured).
    constructor() { super('ppmatting-hrnet', 'PP-Matting HRNet', { fast: 256, balanced: 320, quality: 384 }); this.exportOnly = true; }
  }

  const api = { PPMattingV2Provider, PPMattingHRNetProvider, temporalMode, QUALITY, TEMPORAL_KEY };
  V.PPMattingV2Provider = PPMattingV2Provider;
  V.PPMattingHRNetProvider = PPMattingHRNetProvider;
  V.PPMatting = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
