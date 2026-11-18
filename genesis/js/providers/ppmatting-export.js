/**
 * PP-Matting still / post-capture export path (v0.94). NOT the live preview: the heavier HRNet-W18 model (default here) is meant for
 * stills and offline renders ("do not make the user wait on a heavy model for every camera frame").
 *
 *   const ex = await VS.PPMattingExport.create({ model: 'ppmatting-hrnet' | 'ppmatting-v2', onProgress });
 *   const r  = await ex.matte(canvasOrImageOrVideoFrame, { maxShort: 512 });
 *       r = { alpha: Uint8Array (source w*h), w, h, netSize:[w,h], ms }       alpha is at the SOURCE size (bilinear, like the upstream reference)
 *   const cut = ex.cutout(canvas, r, { decontaminate: true });   // RGBA canvas: the source pixels with the matte as their alpha (decontaminate: optional edge colour clean-up)
 *   ex.dispose();
 *
 *   await ex.matteFrames(frameSource, { engine, onFrame })  // sequential offline render helper: one frame at a time, raw alpha per frame,
 *                                                           // optional TemporalMatte refinement (opts.temporal !== false), progress callback
 *
 * Runs in a Web Worker (ppmatting-worker.js) so the page stays responsive. Weights come from VS.ModelStore (size + SHA-256 verified).
 * Limitation (honest): the networks see at most 512 px on the short side (the size they were trained for), so a 1080p/4K export gets a
 * 512-class matte resampled up to the frame size. Hair detail beyond that resolution is NOT recovered; test 1080p and 4K exports separately.
 */
(function (root) {
  'use strict';
  const V = root.VS = root.VS || {};

  async function ensure() {
    if (!V.ModelStore) await V.loadScript('js/providers/model-store.js');
    if (!V.PPMattingCore) await V.loadScript('js/providers/ppmatting-core.js');
    if (!V.TemporalMatte) await V.loadScript('js/providers/temporal-matte.js');
    if (!V.MatteRefine) await V.loadScript('js/providers/matte-refine.js');
  }

  async function create(opts) {
    opts = opts || {};
    await ensure();
    const modelId = opts.model || 'ppmatting-hrnet', C = V.PPMattingCore;
    const { bytes, entry } = await V.ModelStore.load(modelId, { onProgress: opts.onProgress });
    const buf = bytes[Object.keys(bytes)[0]];
    const base = new URL('.', document.baseURI).href;
    const worker = new Worker(new URL('js/providers/ppmatting-worker.js', base).href);
    const pending = new Map(); let seq = 0;
    worker.onmessage = (ev) => { const m = ev.data, p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m); };
    worker.onerror = (ev) => { const e = new Error('worker crashed: ' + ((ev && ev.message) || 'unknown')); for (const p of pending.values()) p.reject(e); pending.clear(); };
    const send = (msg, tr) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); worker.postMessage(Object.assign({ id }, msg), tr || []); });
    const gpu = !!opts.webgpu && typeof navigator !== 'undefined' && !!navigator.gpu;
    const threads = (typeof self !== 'undefined' && self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined') ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
    const init = await send({ type: 'init', base, bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), gpu, threads });

    const scratch = document.createElement('canvas'), sctx = scratch.getContext('2d', { willReadFrequently: true });
    const srcCanvas = document.createElement('canvas'), srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });

    function dims(src) { return [src.videoWidth || src.naturalWidth || src.width, src.videoHeight || src.naturalHeight || src.height]; }

    async function matte(src, o) {
      o = o || {};
      const [w, h] = dims(src), size = C.stillSize(w, h, o.maxShort || C.MAX_SHORT);
      if (!size) throw new Error('Image is smaller than 32 px');
      scratch.width = size[0]; scratch.height = size[1];
      sctx.drawImage(src, 0, 0, size[0], size[1]);
      const px = sctx.getImageData(0, 0, size[0], size[1]).data, copy = new Uint8ClampedArray(px).buffer;
      const r = await send({ type: 'run', w: size[0], h: size[1], rgba: copy }, [copy]);
      let net = new Uint8Array(r.alpha), removed = 0;
      // v0.95: drop stray false blobs (default ON for stills/exports; pass { keepMain: false } to disable). Real second subjects are kept (see matte-refine.js).
      if (o.keepMain !== false && V.MatteRefine && V.MatteRefine.keepMainSubject) { const k = V.MatteRefine.keepMainSubject(net, r.w, r.h, o.keepMainOpt); net = k.alpha; removed = k.removed; }
      const alpha = C.resizeAlpha(net, r.w, r.h, w, h);
      return { alpha, w, h, netSize: [r.w, r.h], netAlpha: net, ms: r.ms, blobsRemoved: removed };
    }

    /** RGBA cutout canvas at the source size. */
    function cutout(src, r, co) {
      co = co || {};
      const [w, h] = dims(src);
      srcCanvas.width = w; srcCanvas.height = h; srcCtx.drawImage(src, 0, 0, w, h);
      const img = srcCtx.getImageData(0, 0, w, h);
      // v0.94 opt-in: remove the old background's colour from edge pixels (VS.MatteRefine.estimateForeground). The matte itself is not changed.
      if (co.decontaminate && V.MatteRefine) { const d = V.MatteRefine.estimateForeground(img.data, r.alpha, w, h, { radius: co.radius || Math.max(4, Math.round(Math.min(w, h) / 120)) }); img.data.set(d.rgba); }
      C.applyAlphaToRGBA(img.data, r.alpha, img.data);
      const out = document.createElement('canvas'); out.width = w; out.height = h; out.getContext('2d').putImageData(img, 0, 0);
      return out;
    }

    /** Offline sequence render: frameSource(i) -> drawable | null (end). Calls onFrame(i, {raw, refined, w, h, netSize, ms}) per frame, in order. */
    async function matteFrames(frameSource, o) {
      o = o || {}; const tm = o.temporal === false ? null : V.TemporalMatte.create(); let i = 0;
      for (;;) {
        const src = await frameSource(i); if (!src) break;
        const r = await matte(src, o); let refined = null;
        if (tm) { const s = tm.step(r.netAlpha, r.netSize[0], r.netSize[1]); refined = C.resizeAlpha(Uint8Array.from(s.refined), r.netSize[0], r.netSize[1], r.w, r.h); }
        if (o.onFrame) await o.onFrame(i, { raw: r.alpha, refined, w: r.w, h: r.h, netSize: r.netSize, ms: r.ms });
        i++;
      }
      return i;
    }

    return {
      model: modelId, title: entry.title, usingWebGPU: !!init.gpu, matte, cutout, matteFrames,
      dispose() { try { worker.postMessage({ type: 'dispose' }); worker.terminate(); } catch (e) { /* ignore */ } }
    };
  }

  const api = { create };
  V.PPMattingExport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
