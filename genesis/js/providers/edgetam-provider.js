/**
 * EdgeTAMGateProvider: wraps any live provider (MODNet etc.) and removes stray blobs from its matte (a second person, a chair,
 * a lamp) using EdgeTAM (Apache-2.0). Keeps or drops WHOLE blobs of the base matte, so it never cuts holes into the person and the
 * base model's soft hair edges stay untouched.
 *
 * The EdgeTAM encoder is the expensive part, so it runs only every `refreshEvery` frames in the background; in between, the last
 * EdgeTAM mask (grown a little to tolerate motion) is re-intersected with the CURRENT base matte every frame, which is cheap.
 * If EdgeTAM cannot load or fails, the wrapper silently passes the base matte through unchanged: it can only ever improve things.
 *
 * The wrapper is a Proxy: every property/method not overridden here is read from and written to the base provider, and
 * `instanceof` still matches the base class, so the rest of the app treats it exactly like the base provider.
 */
(function (root) {
  'use strict';
  const V = root.VS = root.VS || {};
  const G = 256;                                  // gate grid

  // Match SAM2/EdgeTAM's square encoder canvas without stretching people into
  // a square. Content is resized with its aspect ratio preserved and padded
  // on the right/bottom; this is also how prompt coordinates remain aligned.
  function fitRect(width, height, side) {
    const w = Math.max(1, width | 0), h = Math.max(1, height | 0), scale = side / Math.max(w, h);
    return { x: 0, y: 0, width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
  }

  function resizePlane(src, sw, sh, dw, dh) {
    const out = new Uint8Array(dw * dh);
    if (sw === dw && sh === dh) { out.set(src); return out; }
    const rx = sw / dw, ry = sh / dh;
    for (let y = 0; y < dh; y++) {
      let fy = (y + 0.5) * ry - 0.5; if (fy < 0) fy = 0;
      const y0 = Math.min(sh - 1, fy | 0), y1 = Math.min(sh - 1, y0 + 1), wy = fy - y0;
      for (let x = 0; x < dw; x++) {
        let fx = (x + 0.5) * rx - 0.5; if (fx < 0) fx = 0;
        const x0 = Math.min(sw - 1, fx | 0), x1 = Math.min(sw - 1, x0 + 1), wx = fx - x0;
        const top = src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx;
        const bottom = src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx;
        out[y * dw + x] = Math.round(top * (1 - wy) + bottom * wy);
      }
    }
    return out;
  }

  function fitAlpha(alpha, width, height, side) {
    if (!alpha || alpha.length !== width * height) throw new Error('EdgeTAM source alpha dimensions do not match');
    const rect = fitRect(width, height, side), resized = resizePlane(alpha, width, height, rect.width, rect.height);
    const out = new Uint8Array(side * side);
    for (let y = 0; y < rect.height; y++) out.set(resized.subarray(y * rect.width, (y + 1) * rect.width), (rect.y + y) * side + rect.x);
    return out;
  }

  function unfitAlpha(fitted, width, height, side) {
    if (!fitted || fitted.length !== side * side) throw new Error('EdgeTAM fitted alpha dimensions do not match');
    const rect = fitRect(width, height, side), crop = new Uint8Array(rect.width * rect.height);
    for (let y = 0; y < rect.height; y++) crop.set(fitted.subarray((rect.y + y) * side + rect.x, (rect.y + y) * side + rect.x + rect.width), y * rect.width);
    return resizePlane(crop, rect.width, rect.height, width, height);
  }

  function create(base, options) {
    const o = Object.assign({ refreshEvery: 8, dilate: 2, keepDilate: 3, feather: 2, minOverlap: 0.3 }, options || {});
    const own = {
      status: 'idle', gateError: null, gate: null, gateAge: 0, frame: 0, busy: false, enc: null, dec: null, ortRef: null,
      modelId: null, usingWebGPU: false, precisionFallback: null, modelSha256: null, registryVersion: null, modelTitle: null, modelIdentityError: null, runtimeSource: null,
      info: null, sourceCanvas: null, sourceCtx: null, frameCanvas: null, frameCtx: null, baseCanvas: null, baseCtx: null, outCanvas: null, outCtx: null, gateCanvas: null, gateCtx: null, gateImg: null
    };
    const C = () => V.EdgeTAMCore;

    function ensureCanvases() {
      if (own.frameCanvas) return;
      const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
      own.frameCanvas = mk(1024, 1024); own.frameCtx = own.frameCanvas.getContext('2d', { willReadFrequently: true });
      own.baseCanvas = mk(G, G); own.baseCtx = own.baseCanvas.getContext('2d', { willReadFrequently: true });
      own.gateCanvas = mk(G, G); own.gateCtx = own.gateCanvas.getContext('2d'); own.gateImg = own.gateCtx.createImageData(G, G);
      own.outCanvas = mk(2, 2); own.outCtx = own.outCanvas.getContext('2d');
    }

    function snapshotFrame(video) {
      const width = video && (video.videoWidth || video.width);
      const height = video && (video.videoHeight || video.height);
      if (!(width > 0 && height > 0)) throw new Error('EdgeTAM source frame has no dimensions');
      if (!own.sourceCanvas || own.sourceCanvas.width !== width || own.sourceCanvas.height !== height) {
        own.sourceCanvas = document.createElement('canvas');
        own.sourceCanvas.width = width; own.sourceCanvas.height = height;
        own.sourceCtx = own.sourceCanvas.getContext('2d');
      }
      if (!own.sourceCtx) throw new Error('EdgeTAM could not create a source-frame snapshot');
      own.sourceCtx.drawImage(video, 0, 0, width, height);
      Object.defineProperties(own.sourceCanvas, {
        videoWidth: { configurable: true, value: width },
        videoHeight: { configurable: true, value: height }
      });
      return own.sourceCanvas;
    }

    function alphaAtGate(maskCanvas) {
      own.baseCtx.clearRect(0, 0, G, G);
      const sw = maskCanvas.width || G, sh = maskCanvas.height || G, rect = fitRect(sw, sh, G);
      // Canvas scaling is bilinear; unused square padding remains transparent.
      own.baseCtx.drawImage(maskCanvas, 0, 0, rect.width, rect.height);
      const d = own.baseCtx.getImageData(0, 0, G, G).data, a = new Uint8Array(G * G);
      for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
      return a;
    }

    async function load(opts) {
      own.status = 'loading';
      try {
        await V.loadOrt();
        if (typeof ort === 'undefined' || !ort.InferenceSession) throw new Error('onnxruntime-web unavailable');
        const gpuAvailable = typeof navigator !== 'undefined' && !!navigator.gpu;
        // A WebGPU-capable browser is not proof that this specific fp16 graph
        // will compile or execute on its adapter. Try the accelerated model,
        // then fall back to the fp32/WASM checkpoint before declaring the gate
        // unavailable. CPU-only browsers never download the fp16 model.
        const candidates = gpuAvailable ? ['edgetam', 'edgetam-fp32'] : ['edgetam-fp32'];
        const failures = [];
        for (const id of candidates) {
          let encoder = null, decoder = null;
          try {
            const { bytes, entry, registryVersion } = await V.ModelStore.load(id, { onProgress: opts && opts.onProgress });
            own.registryVersion = registryVersion;
            own.modelTitle = entry.title || id;
            own.modelSha256 = null;
            try {
              if (!V.MatteQualificationIdentity) throw new Error('Canonical identity helper unavailable');
              own.modelSha256 = await V.MatteQualificationIdentity.hashModelFiles(bytes);
            } catch (identityError) {
              own.modelIdentityError = String((identityError && identityError.message) || identityError);
            }
            const external = entry.external || {};
            const ext = Object.keys(external).map((path) => ({ path, data: bytes[external[path]] }));
            const encoderDataName = Object.keys(external).find((path) => /vision_encoder/.test(path));
            const decoderDataName = Object.keys(external).find((path) => /prompt_encoder_mask_decoder/.test(path));
            const gpu = id === 'edgetam';
            // Do not pass WASM as a fallback in the same ORT session request:
            // ORT may silently select it and the diagnostics would claim that
            // the FP16 EdgeTAM graph is running on WebGPU. A failed WebGPU
            // compile proceeds to the separately licensed/verified FP32-WASM
            // checkpoint below, where the backend is explicitly known.
            const encoderProviders = gpu ? ['webgpu'] : ['wasm'];
            encoder = await ort.InferenceSession.create(bytes[entry.encoder], {
              executionProviders: encoderProviders,
              graphOptimizationLevel: 'all',
              externalData: encoderDataName ? ext.filter((item) => item.path === encoderDataName) : []
            });
            decoder = await ort.InferenceSession.create(bytes[entry.decoder], {
              executionProviders: ['wasm'],
              graphOptimizationLevel: 'all',
              externalData: decoderDataName ? ext.filter((item) => item.path === decoderDataName) : []
            });
            own.enc = encoder; own.dec = decoder; own.ortRef = ort;
            own.modelId = id; own.usingWebGPU = gpu; own.runtimeSource = V.ortSource || null;
            own.precisionFallback = failures.length ? failures.join(' | ') : null;
            own.gateError = null; own.status = 'ready';
            return;
          } catch (error) {
            try { encoder && encoder.release && encoder.release(); } catch (e) {}
            try { decoder && decoder.release && decoder.release(); } catch (e) {}
            failures.push(id + ': ' + String(error && error.message || error));
          }
        }
        throw new Error('No EdgeTAM runtime variant could start: ' + failures.join(' | '));
      } catch (e) {
        own.status = 'failed';
        own.gateError = String((e && e.message) || e);
      }
    }
    async function refresh(video, baseAlpha) {
      if (own.busy || own.status !== 'ready') return;
      own.busy = true;
      // Reset the retry clock before doing work, not only after a successful
      // gate. A missing/unsafe subject or transient runtime error must not
      // trigger another 1024px EdgeTAM pass on the very next camera frame.
      own.gateAge = 0;
      try {
        ensureCanvases();
        const vw = video && (video.videoWidth || video.width), vh = video && (video.videoHeight || video.height);
        if (!(vw > 0 && vh > 0)) throw new Error('EdgeTAM frame has no dimensions');
        const rect = fitRect(vw, vh, 1024);
        // EdgeTAM's SAM2-style encoder expects 1024 square input. Pad with
        // ImageNet mean colour rather than stretching a 16:9 / portrait person.
        own.frameCtx.fillStyle = 'rgb(124,116,104)';
        own.frameCtx.fillRect(0, 0, 1024, 1024);
        own.frameCtx.drawImage(video, 0, 0, rect.width, rect.height);
        const rgba = own.frameCtx.getImageData(0, 0, 1024, 1024).data;
        const r = await C().refreshGate(own.ortRef, own.enc, own.dec, rgba, baseAlpha, G, G);
        if (!r) { own.gate = null; return; }
        const grown = C().softGate(r.gate, G, G, o.dilate, 0);          // the SAME mask that is used every frame, so the safety check matches reality
        const keep = C().componentGate(baseAlpha, grown, G, G, 128, o.minOverlap);
        let baseArea = 0, kept = 0; for (let i = 0; i < baseAlpha.length; i++) if (baseAlpha[i] >= 128) { baseArea++; if (keep[i]) kept++; }
        const safe = C().gateIsSafe(baseArea, kept, r.obj);
        let gateFg = 0; for (let i = 0; i < r.gate.length; i++) if (r.gate[i]) gateFg++;
        own.info = { iou: r.iou, obj: r.obj, gateFrac: gateFg / r.gate.length, baseArea, kept, safe, box: [r.bbox.x0, r.bbox.y0, r.bbox.x1, r.bbox.y1] };
        own.gate = safe ? grown : null;
        own.gateAge = 0;
      } catch (e) { own.gateError = String((e && e.message) || e); own.gate = null; }
      finally { own.busy = false; }
    }

    function compose(mask) {
      const w = mask.width, h = mask.height;
      if (own.outCanvas.width !== w || own.outCanvas.height !== h) { own.outCanvas.width = w; own.outCanvas.height = h; }
      const baseAlpha = alphaAtGate(mask);
      const keep = C().componentGate(baseAlpha, own.gate, G, G, 128, o.minOverlap);
      const soft = C().softGate(keep, G, G, o.keepDilate, o.feather), d = own.gateImg.data;
      for (let i = 0, j = 0; i < soft.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = soft[i]; }
      own.gateCtx.putImageData(own.gateImg, 0, 0);
      own.outCtx.globalCompositeOperation = 'copy'; own.outCtx.drawImage(mask, 0, 0, w, h);
      const rect = fitRect(w, h, G);
      own.outCtx.globalCompositeOperation = 'destination-in';
      // Crop away only the synthetic padding before scaling the gate back to
      // the matte's native aspect ratio.
      own.outCtx.drawImage(own.gateCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, w, h);
      own.outCtx.globalCompositeOperation = 'source-over';
      return own.outCanvas;
    }

    /** Tracker-first hook (used by the hybrid engine): gates the coarse matte in place BEFORE its edge band is built. Returns true when a gate was applied. */
    const tracker = {
      ready: () => own.status === 'ready',
      async step(video, alpha, w, h) {
        ensureCanvases();
        own.frame++; own.gateAge++;
        const grid = fitAlpha(alpha, w, h, G);
        const first = own.frame === 1, due = own.gateAge >= o.refreshEvery;
        if (first || (due && !own.busy)) { const p = refresh(video, grid); if (first) await p; }
        if (!own.gate) return false;
        const keep = C().componentGate(grid, own.gate, G, G, 128, o.minOverlap);
        const soft = C().softGate(keep, G, G, o.keepDilate, o.feather);
        const nativeSoft = unfitAlpha(soft, w, h, G);
        for (let i = 0; i < alpha.length; i++) alpha[i] = (alpha[i] * nativeSoft[i] / 255 + 0.5) | 0;
        return true;
      }
    };
    own.hooked = !!(base && typeof base.setTrackerHook === 'function');
    if (own.hooked) base.setTrackerHook(tracker);

    const overrides = {
      async initialize(...args) {
        const r = await base.initialize(...args);
        await load({ onProgress: base.onProgress });
        return r;
      },
      async getQualificationIdentity() {
        if (own.status !== 'ready') throw new Error('EdgeTAM runtime is not ready; exact runtime identity is unavailable.');
        if (own.runtimeSource !== 'local') throw new Error('EdgeTAM is using a non-bundled or unknown ONNX Runtime source; exact runtime identity is unavailable for automatic qualification.');
        if (!own.modelSha256) throw new Error('EdgeTAM model bytes could not be fingerprinted: ' + (own.modelIdentityError || 'SHA-256 unavailable'));
        if (!base || typeof base.getQualificationIdentity !== 'function') {
          throw new Error('The wrapped base provider cannot supply a canonical qualification identity.');
        }
        const Q = V.MatteQualificationIdentity;
        if (!Q) throw new Error('Canonical matte qualification identity helper is unavailable.');
        const parentIdentity = await base.getQualificationIdentity();
        return Q.extend(parentIdentity, {
          modelVersionSuffix: '+edgetam-' + own.modelId + '@registry-' + String(own.registryVersion),
          modelSha256: own.modelSha256,
          preprocessResources: ['js/providers/edgetam-provider.js', 'js/providers/edgetam-core.js'],
          preprocessConfig: {
            encoderInputSide: 1024,
            gateGrid: G,
            preserveAspectRatio: true,
            padding: 'rgb(124,116,104)',
            resize: 'half-pixel-bilinear'
          },
          postprocessResources: ['js/providers/edgetam-provider.js', 'js/providers/edgetam-core.js'],
          postprocessConfig: {
            refreshEvery: o.refreshEvery,
            dilate: o.dilate,
            keepDilate: o.keepDilate,
            feather: o.feather,
            minOverlap: o.minOverlap,
            gateGrid: G,
            trackerHooked: !!own.hooked
          },
          runtime: {
            name: 'onnxruntime-web-edgetam',
            backend: own.usingWebGPU ? 'encoder-webgpu+decoder-wasm' : 'encoder-wasm+decoder-wasm',
            resources: [
              'js/ort-loader.js',
              'vendor/ort/ort.min.js',
              'vendor/ort/ort.webgpu.min.js',
              'vendor/ort/ort-wasm-simd-threaded.js',
              'vendor/ort/ort-wasm-simd-threaded.wasm',
              'vendor/ort/ort-wasm-simd-threaded.asyncify.js',
              'vendor/ort/ort-wasm-simd-threaded.asyncify.wasm'
            ],
            config: {
              selectedModel: own.modelId,
              runtimeSource: own.runtimeSource,
              precisionFallback: String(own.precisionFallback || ''),
              decoderBackend: 'wasm'
            }
          }
        });
      },
      async segment(video) {
        // Hybrid owns its own same-frame snapshot and calls the tracker hook
        // before building/refining the uncertainty band. Do not add another
        // full-frame copy on that route.
        const sourceFrame = (own.hooked || own.status !== 'ready') ? video : snapshotFrame(video);
        const res = await base.segment(sourceFrame);
        if (own.hooked && base.hy && base.hy.tracked) return res;       // hybrid already applied the tracker mask before refining: do not gate twice
        // If Hybrid could not capture a paired source frame, do not retry
        // EdgeTAM against the live video after asynchronous inference.
        if (own.hooked && !base._hyLastFrame) return res;
        if (own.status !== 'ready' || !res || !res.segmentationMask) return res;
        ensureCanvases();
        own.frame++; own.gateAge++;
        const first = own.frame === 1, due = own.gateAge >= o.refreshEvery;
        if (first || (due && !own.busy)) {
          const alpha = alphaAtGate(res.segmentationMask);
          // Tracker and base matte are built from the same captured camera frame,
          // never from a newer live-video frame after asynchronous inference.
          const trackerFrame = own.hooked ? base._hyLastFrame : sourceFrame;
          const p = refresh(trackerFrame, alpha);
          if (first) await p;                                         // the first picture must not show a stray blob
        }
        return own.gate ? Object.assign({}, res, { segmentationMask: compose(res.segmentationMask) }) : res;
      },
      dispose() {
        try { own.enc && own.enc.release && own.enc.release(); own.dec && own.dec.release && own.dec.release(); } catch (e) { /* ignore */ }
        own.enc = own.dec = null; own.sourceCanvas = own.frameCanvas = null; own.sourceCtx = own.frameCtx = null;
        own.status = 'idle'; return base.dispose && base.dispose();
      },
      get label() {
        const baseLabel = own.status === 'failed' && base.hy
          ? 'Genesis Hybrid · PP-MattingV2'
          : (base.label || 'Matte');
        return String(baseLabel) + ' + EdgeTAM cleanup' + (own.status === 'failed' ? ' (cleanup unavailable)' : '');
      },
      set label(v) { base.label = v; },
      get edgetam() {
        return {
          status: own.status, error: own.gateError, gateActive: !!own.gate,
          refreshEvery: o.refreshEvery, modelId: own.modelId,
          runtime: own.usingWebGPU ? 'webgpu-encoder+wasm-decoder' : (own.modelId ? 'wasm' : null),
          precisionFallback: own.precisionFallback, runtimeSource: own.runtimeSource, info: own.info
        };
      }
    };

    return new Proxy(base, {
      get(t, k) { if (k in overrides || Object.getOwnPropertyDescriptor(overrides, k)) return Object.getOwnPropertyDescriptor(overrides, k).get ? Object.getOwnPropertyDescriptor(overrides, k).get() : overrides[k]; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; },
      set(t, k, v) { if (k === 'label') { t.label = v; return true; } t[k] = v; return true; },
      has(t, k) { return k in overrides || k in t; },
      getPrototypeOf(t) { return Object.getPrototypeOf(t); }
    });
  }

  const api = { create, fitRect, fitAlpha, unfitAlpha };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  V.EdgeTAMGate = api;
})(typeof window !== 'undefined' ? window : globalThis);
