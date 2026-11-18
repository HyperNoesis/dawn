/* PP-Matting inference worker (v0.94). Runs onnxruntime-web inside a Web Worker so loading and inference never block the page.
 * The model bytes are fetched, size-checked and SHA-256 verified on the main thread by VS.ModelStore, then transferred here.
 * Protocol (every message carries an id):
 *   {type:'init', base, bytes:ArrayBuffer, gpu:boolean, threads:number}      -> {type:'ready', gpu:boolean, note, inName, outName}
 *   {type:'run', w, h, rgba:ArrayBuffer}                                      -> {type:'result', w, h, alpha:ArrayBuffer(uint8 w*h), ms}
 *   {type:'dispose'}
 * Pre/post-processing is js/providers/ppmatting-core.js (identical to the upstream yakhyo/ppmatting reference, checked in tools/unit).
 * The matte is returned RAW (no mask-clean, no smoothing): refinement is the provider's job so raw and refined can be A/B compared. */
'use strict';
let session = null, inName = 'img', outName = 'alpha', core = null;
let inBuf = null;

async function init(m) {
  const base = m.base;
  const gpu = !!m.gpu && typeof navigator !== 'undefined' && !!navigator.gpu;
  importScripts(base + 'vendor/ort/' + (gpu ? 'ort.webgpu.min.js' : 'ort.min.js'));
  importScripts(base + 'js/providers/ppmatting-core.js');
  core = self.VS.PPMattingCore;
  const stem = gpu ? 'ort-wasm-simd-threaded.jsep' : 'ort-wasm-simd-threaded';
  ort.env.wasm.wasmPaths = { mjs: base + 'vendor/ort/' + stem + '.js', wasm: base + 'vendor/ort/' + stem + '.wasm' };
  ort.env.wasm.numThreads = (m.threads | 0) > 1 ? (m.threads | 0) : 1; ort.env.wasm.proxy = false;
  const bytes = new Uint8Array(m.bytes);
  if (bytes.byteLength < 1000000) throw new Error('model file too small');
  let usedGpu = false, lastErr = null, note = '';
  // webgpu ALONE first: with ['webgpu','wasm'] ORT can silently pick wasm and we would mislabel the backend.
  for (const eps of (gpu ? [['webgpu'], ['wasm']] : [['wasm']])) {
    try {
      session = await ort.InferenceSession.create(bytes, { executionProviders: eps, graphOptimizationLevel: 'all', extra: { session: { intra_op: { allow_spinning: '0' } } } });
      usedGpu = eps[0] === 'webgpu'; break;
    } catch (e) { lastErr = e; if (!note) note = String((e && e.message) || e).slice(0, 200); }
  }
  if (!session) throw lastErr || new Error('no execution provider worked');
  inName = (session.inputNames && session.inputNames[0]) || 'img';
  outName = (session.outputNames && session.outputNames[0]) || 'alpha';
  return { gpu: usedGpu, note: usedGpu ? '' : note, inName, outName };
}

async function run(m) {
  const w = m.w, h = m.h, t0 = (self.performance || Date).now();
  if (w % 32 || h % 32) throw new Error('size must be a multiple of 32, got ' + w + 'x' + h);
  const rgba = new Uint8ClampedArray(m.rgba);
  inBuf = core.toTensor(rgba, w, h, inBuf && inBuf.length === 3 * w * h ? inBuf : null);
  const out = await session.run({ [inName]: new ort.Tensor('float32', inBuf, [1, 3, h, w]) });
  const t = out[outName] || out[Object.keys(out)[0]];
  const dims = t.dims || [1, 1, h, w], oh = dims[dims.length - 2], ow = dims[dims.length - 1];
  const alpha = core.toAlpha(t.data, ow * oh);
  return { w: ow, h: oh, alpha, ms: (self.performance || Date).now() - t0 };
}

self.onmessage = async (ev) => {
  const m = ev.data, id = m.id;
  try {
    if (m.type === 'init') { const r = await init(m); self.postMessage({ id, type: 'ready', gpu: r.gpu, note: r.note, inName: r.inName, outName: r.outName }); }
    else if (m.type === 'run') { const r = await run(m); self.postMessage({ id, type: 'result', w: r.w, h: r.h, alpha: r.alpha.buffer, ms: r.ms }, [r.alpha.buffer]); }
    else if (m.type === 'dispose') { try { session && session.release && session.release(); } catch (e) { /* ignore */ } session = null; inBuf = null; }
  } catch (e) { self.postMessage({ id, type: 'error', message: String((e && e.message) || e).slice(0, 300) }); }
};
