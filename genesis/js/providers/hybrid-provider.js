/**
 * GenesisHybridProvider (v0.99, BETA): PP-MattingV2 coarse matte + band-only tile refinement + motion-compensated temporal blend.
 * Apache-2.0 models only (PP-MattingV2); no new weights. Everything stays on the device.
 *
 * Per segment() call:
 *   1. the parent PP-MattingV2 provider produces the coarse matte (its own TemporalMatte, VideoGuard and fallbacks are unchanged)
 *   2. the matte is upsampled to a refined size (long edge <= 512, localStorage vs_hy_long) and an uncertainty band (hair, fingers, soft edges) is built
 *   3. tiles that touch the band are re-run through the SAME model at higher pixel density: a 192 px crop of the video (128 px core + 32 px context margin);
 *      only the core is written back, and only inside the feathered band. Refined tiles are cached and reused until their coarse content changes.
 *      How many tiles per call is decided by a time budget (vs_hy_target_ms, default 70): a slow phone gets 0 tiles and behaves like plain PP-MattingV2.
 *   4. motion-compensated temporal blend (history weight <= 0.25) on the merged matte; skipped after a scene cut or subject loss
 * Any error three times in a row switches the hybrid stage off and the provider returns the parent's matte. Kill switch: localStorage vs_hy = 0.
 * Other flags: vs_hy_tiles (max tiles per call, default 3), vs_hy_warp = 0 (no temporal pass).
 *
 * UNVERIFIED (needs a real browser and phone): that the worker accepts 192x192 inputs on every backend, that tile crops look as good as full-frame
 * inference on real hair, and the on-device timings. Ships off the critical path: a failure returns the parent's result.
 */
(function (root) {
  'use strict';
  const V = root.VS = root.VS || {};
  const Parent = V.PPMattingV2Provider;
  if (!Parent) return;

  const TILE = 128, MARGIN = 32, IN = TILE + 2 * MARGIN, LW = 128;
  const ls = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsNum = (k, d, lo, hi) => { const v = parseInt(ls(k), 10); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const hyOn = () => ls('vs_hy') !== '0';
  const warpOn = () => ls('vs_hy_warp') !== '0';

  class GenesisHybridProvider extends Parent {
    constructor() {
      super();
      this.title = 'Genesis UltraMatte';
      this.label = 'Genesis UltraMatte · PP-MattingV2 (beta, local)';
      this.hy = { tiles: 0, budget: 0, bandPct: 0, refined: 0, cached: 0, rejected: 0, warped: 0, ms: 0, size: null, errors: 0, lastError: '', snapshotFailures: 0, lastSnapshotError: '', off: false };
      this._hyReset();
    }

    _hyReset() {
      this._cache = new Map(); this._prevOut = null; this._prevLuma = null; this._ow = 0; this._oh = 0; this._tileMs = 0; this._frames = 0;
    }

    /** Tracker-first mode (EdgeTAM): the hook cleans the coarse matte BEFORE the uncertainty band is built, so stray blobs never cost refinement tiles. */
    setTrackerHook(h) { this.trackerHook = h || null; }
    resetTemporal() { super.resetTemporal(); this._hyReset(); }
    dispose() { this._hyReset(); this._tc = this._lc = this._oc = this._hyFrame = null; return super.dispose(); }

    async initialize(qualityMode, opts) {
      if (!V.BandRefineCore) await V.loadScript('js/providers/band-refine-core.js');
      return super.initialize(qualityMode, opts);
    }

    async segment(video) {
      const t0 = performance.now();
      this.hy.tracked = false;

      // Snapshot before the parent starts asynchronous inference. The coarse matte,
      // EdgeTAM tracker and every high-resolution tile must describe the SAME camera
      // frame; reading the live <video> again after the worker responds mixes frames.
      let refineFrame = null;
      if (hyOn() && !this.hy.off && !this._rect) {
        try {
          refineFrame = this._snapshotFrame(video);
        } catch (e) {
          this.hy.snapshotFailures = (this.hy.snapshotFailures || 0) + 1;
          this.hy.lastSnapshotError = String((e && e.message) || e);
        }
      }

      const res = await super.segment(video);
      const coarseMs = performance.now() - t0;
      if (!hyOn() || this.hy.off || this._rect || !refineFrame) return res; // fail closed to the parent's matte if snapshotting fails
      const gd = this.lastGuard;
      if (gd && gd.useHeld) { this._hyReset(); return res; }                // subject lost: the parent is showing a fading held matte
      if (gd && gd.resetTemporal) this._hyReset();
      const coarse = this.lastRefined || this.lastRaw, size = this.lastSize;
      if (!coarse || !size) return res;
      const h0 = performance.now();
      try {
        const out = await this._hybrid(refineFrame, coarse, size[0], size[1], coarseMs);
        this.hy.ms = Math.round(performance.now() - h0 + coarseMs);
        this.hy.errors = 0;
        return out ? Object.assign({}, res, { segmentationMask: out }) : res;
      } catch (e) {
        this.hy.errors++; this.hy.lastError = String((e && e.message) || e);
        if (this.hy.errors >= 3) this.hy.off = true;
        this._hyReset();
        return res;
      }
    }

    _canvas(w, h, willRead) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      return { c, x: c.getContext('2d', willRead ? { willReadFrequently: true } : undefined) };
    }

    _snapshotFrame(video) {
      const w = video && (video.videoWidth || video.width);
      const h = video && (video.videoHeight || video.height);
      if (!(w > 0 && h > 0)) throw new Error('Cannot snapshot a frame without dimensions');
      if (!this._hyFrame || this._hyFrame.c.width !== w || this._hyFrame.c.height !== h) {
        this._hyFrame = this._canvas(w, h, false);
      }
      if (!this._hyFrame.x) throw new Error('Could not create the hybrid frame snapshot context');
      this._hyFrame.x.drawImage(video, 0, 0, w, h);
      return this._hyFrame.c;
    }

    async _refineTile(video, core, OW, OH, vw, vh) {
      const B = V.BandRefineCore, crop = B.cropRect(core, MARGIN, OW, OH, IN);
      if (!this._tc) this._tc = this._canvas(IN, IN, true);
      this._tc.x.drawImage(video, crop.x * vw / OW, crop.y * vh / OH, IN * vw / OW, IN * vh / OH, 0, 0, IN, IN);
      const buf = new Uint8ClampedArray(this._tc.x.getImageData(0, 0, IN, IN).data).buffer;
      const r = await this._send({ type: 'run', w: IN, h: IN, rgba: buf }, [buf]);
      if (r.w !== IN || r.h !== IN) throw new Error('tile output ' + r.w + 'x' + r.h);
      const a = new Uint8Array(r.alpha), ox = core.x - crop.x, oy = core.y - crop.y, out = new Uint8Array(core.w * core.h);
      for (let y = 0; y < core.h; y++) for (let x = 0; x < core.w; x++) out[y * core.w + x] = a[(oy + y) * IN + ox + x];
      return out;
    }

    async _hybrid(video, coarse, cw, ch, coarseMs) {
      const B = V.BandRefineCore, PC = V.PPMattingCore, vw = video.videoWidth || video.width, vh = video.videoHeight || video.height;
      const longCap = lsNum('vs_hy_long', 512, 256, 768), long = Math.min(Math.max(vw, vh), 2 * Math.max(cw, ch), longCap), sc = long / Math.max(vw, vh);
      const OW = Math.round(vw * sc / 2) * 2, OH = Math.round(vh * sc / 2) * 2;
      if (OW < IN || OH < IN) return null;                                   // too small for 192 px crops: plain PP-MattingV2
      if (OW !== this._ow || OH !== this._oh) { this._hyReset(); this._ow = OW; this._oh = OH; this._up = new Uint8Array(OW * OH); this._wp = new Uint8Array(OW * OH); }
      this._frames++;
      const up = PC.resizeAlpha(coarse, cw, ch, OW, OH, this._up);
      const T = this.trackerHook;
      if (T && T.ready()) { try { this.hy.tracked = !!(await T.step(video, up, OW, OH)); } catch (e) { this.hy.tracked = false; } }   // tracker mask first, then band + tiles
      const band = B.buildBand(up, OW, OH, { dilate: 3 }), soft = B.feather(band, OW, OH, 2);
      const cands = B.pickTiles(band, OW, OH, TILE, { minCount: 24 });
      const target = lsNum('vs_hy_target_ms', 70, 20, 400), maxTiles = lsNum('vs_hy_tiles', 3, 0, 8);
      if (!this._tileMs) this._tileMs = Math.max(8, coarseMs * 0.5);
      let budget = B.tileBudget({ targetMs: target, coarseMs, tileMs: this._tileMs, maxTiles });
      if (budget === 0 && maxTiles > 0 && coarseMs < target && this._frames % 45 === 0) budget = 1;   // probe so a pessimistic first estimate can recover
      const cores = cands.map((core) => ({ core, coarse: B.extract(up, core, OW), cached: this._cache.get(core.key) }));
      const stale = cores.filter((c) => !c.cached || B.meanAbsDiff(c.cached.coarse, c.coarse) > 4);   // busiest first
      let refined = 0, rejected = 0; const fresh = new Set();
      for (const c of stale) {
        if (refined >= budget) break;
        const t1 = performance.now(), r = await this._refineTile(video, c.core, OW, OH, vw, vh);
        this._tileMs = this._tileMs * 0.7 + (performance.now() - t1) * 0.3;
        if (B.tileSane(c.coarse, r)) { this._cache.set(c.core.key, { coarse: c.coarse, alpha: r }); fresh.add(c.core.key); refined++; }
        else { this._cache.delete(c.core.key); rejected++; }
      }
      let cached = 0;
      for (const c of cores) {                                               // merge fresh tiles and still-valid cached tiles; stale ones stay coarse
        const e = this._cache.get(c.core.key);
        if (!e) continue;
        if (!fresh.has(c.core.key) && B.meanAbsDiff(e.coarse, c.coarse) > 4) continue;
        B.mergeCore(up, e.alpha, c.core, soft, OW); cached += fresh.has(c.core.key) ? 0 : 1;
      }
      const keep = new Set(cands.map((c) => c.key)); for (const k of this._cache.keys()) if (!keep.has(k)) this._cache.delete(k);

      let warped = 0;
      if (warpOn()) {
        const LH = Math.max(8, Math.round(LW * vh / vw));
        if (!this._lc || this._lc.c.height !== LH) this._lc = this._canvas(LW, LH, true);
        this._lc.x.drawImage(video, 0, 0, LW, LH);
        const luma = B.lumaFromRGBA(this._lc.x.getImageData(0, 0, LW, LH).data, LW, LH);
        if (this._prevOut && this._prevLuma && this._prevLuma.length === luma.length) {
          const mot = B.blockMotion(this._prevLuma, luma, LW, LH, { block: 8, range: 3 }), wp = B.warpAlpha(this._prevOut, OW, OH, mot, LW, LH, this._wp);
          warped = B.gatedTemporal(up, wp, OW, OH, mot, LW, LH, { hist: B.HIST_CAP }).blended;
        }
        this._prevLuma = luma;
      }
      if (!this._prevOut || this._prevOut.length !== up.length) this._prevOut = new Uint8Array(up.length);
      this._prevOut.set(up);

      if (!this._oc || this._oc.c.width !== OW || this._oc.c.height !== OH) { this._oc = this._canvas(OW, OH); this._oimg = this._oc.x.createImageData(OW, OH); }
      const px = this._oimg.data;
      for (let i = 0, n = OW * OH; i < n; i++) { const o = i * 4; px[o] = px[o + 1] = px[o + 2] = 255; px[o + 3] = up[i]; }
      this._oc.x.putImageData(this._oimg, 0, 0);
      Object.assign(this.hy, { tiles: cands.length, budget, bandPct: Math.round(100 * B.count(band) / (OW * OH) * 10) / 10, refined, cached, rejected, warped, size: [OW, OH] });
      return this._oc.c;
    }
  }

  V.GenesisHybridProvider = GenesisHybridProvider;
  if (typeof module !== 'undefined' && module.exports) module.exports = { GenesisHybridProvider };
})(typeof window !== 'undefined' ? window : globalThis);
