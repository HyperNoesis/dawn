/**
 * WebGPU probe (v0.98): says exactly what this browser/device offers, so a silent WASM fallback can be explained instead of guessed.
 * Pure: takes the navigator and storage to inspect, so it is unit-tested without a GPU. Returns { lines: string[], ok: boolean, adapter: object|null }.
 *   const r = await VS.GpuProbe.run(navigator, localStorage);
 */
(function (root) {
  'use strict';
  const LIMITS = ['maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupSizeX', 'maxStorageBuffersPerShaderStage'];
  const msg = (e) => String((e && e.message) || e).slice(0, 200);

  async function run(nav, storage) {
    const lines = []; let ok = false, adapterOut = null;
    let flag = '(unset)'; try { const v = storage && storage.getItem('vs_webgpu'); if (v != null) flag = v; } catch (e) { flag = '(unreadable)'; }
    lines.push('navigator.gpu present: ' + !!(nav && nav.gpu)); lines.push('vs_webgpu flag: ' + flag);
    if (!nav || !nav.gpu) { lines.push('RESULT: this browser exposes no WebGPU, so WASM is the only path.'); return { lines, ok, adapter: null }; }
    let ad = null;
    try { ad = await nav.gpu.requestAdapter(); } catch (e) { lines.push('requestAdapter threw: ' + msg(e)); }
    if (!ad) { lines.push('RESULT: no WebGPU adapter was returned (the GPU or driver is blocklisted or disabled).'); return { lines, ok, adapter: null }; }
    let info = ad.info || null;
    if (!info && typeof ad.requestAdapterInfo === 'function') { try { info = await ad.requestAdapterInfo(); } catch (e) { info = null; } }
    if (info) { adapterOut = { vendor: info.vendor || '', architecture: info.architecture || '', device: info.device || '', description: info.description || '' }; lines.push('adapter: ' + [adapterOut.vendor, adapterOut.architecture, adapterOut.device, adapterOut.description].filter(Boolean).join(' / ')); }
    else lines.push('adapter info: not exposed');
    try { lines.push('features: ' + (ad.features ? Array.from(ad.features).join(', ') : '(none listed)')); } catch (e) { lines.push('features: unreadable'); }
    if (ad.isFallbackAdapter) lines.push('NOTE: this is a software fallback adapter (slow).');
    const lim = ad.limits || {}; lines.push('limits: ' + LIMITS.map((k) => k + '=' + (lim[k] != null ? lim[k] : '?')).join(', '));
    try { const dev = await ad.requestDevice(); ok = true; lines.push('requestDevice: ok'); if (dev && typeof dev.destroy === 'function') dev.destroy(); }
    catch (e) { lines.push('requestDevice FAILED: ' + msg(e)); }
    lines.push(ok ? 'RESULT: WebGPU can start here. If the engine still reports WASM, read the "fallback reason" line.' : 'RESULT: an adapter exists but no device could be created, so WebGPU cannot be used.');
    return { lines, ok, adapter: adapterOut };
  }

  const api = { run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {};
  root.VS.GpuProbe = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
