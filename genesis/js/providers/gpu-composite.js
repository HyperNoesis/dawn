/**
 * GPU compositor, WebGPU path (v0.98, mandate section 8). OPT-IN and NOT TESTED ON A GPU: written in a sandbox with no WebGPU adapter.
 * Off unless localStorage vs_webgpu_composite = '1'. The live WebGL compositor (gl-matte.js) stays the default and the fallback; nothing here
 * replaces it. If WebGPU is missing, the adapter request fails, or any call throws, create() resolves null and the caller keeps using WebGL.
 *
 * Maths: out = alpha * F + (1 - alpha) * B, evaluated on LINEAR light (sRGB decoded before, encoded after) so edges do not get dark halos.
 * Inputs are straight (non-premultiplied) alpha. `compositeCPU` below is the reference the shader mirrors and the unit test checks.
 *
 *   const gc = await VS.GpuComposite.create(canvas);          // null when unsupported
 *   gc.draw(videoOrCanvas, alphaCanvasOrImageBitmap, bgCanvasOrImage);   // one pass, three external-copy textures, reused between frames
 *   gc.dispose();
 */
(function (root) {
  'use strict';
  const srgbToLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const linToSrgb = (c) => { c = c < 0 ? 0 : c > 1 ? 1 : c; return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); };

  /** Reference composite for one pixel. fg, bg: [r,g,b] 0..255 sRGB; alpha 0..1 straight. Returns [r,g,b] 0..255. */
  function compositeCPU(fg, bg, alpha, linear) {
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha, out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      if (linear === false) out[c] = a * fg[c] + (1 - a) * bg[c];
      else out[c] = linToSrgb(a * srgbToLin(fg[c]) + (1 - a) * srgbToLin(bg[c]));
    }
    return out;
  }

  const WGSL = `
struct VOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f };
@vertex fn vs(@builtin(vertex_index) i : u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o : VOut; o.pos = vec4f(p[i], 0.0, 1.0); o.uv = vec2f((p[i].x + 1.0) * 0.5, 1.0 - (p[i].y + 1.0) * 0.5); return o;
}
@group(0) @binding(0) var smp : sampler;
@group(0) @binding(1) var fgTex : texture_external;
@group(0) @binding(2) var aTex : texture_2d<f32>;
@group(0) @binding(3) var bgTex : texture_2d<f32>;
fn toLin(c : vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
fn toSrgb(c : vec3f) -> vec3f { let x = clamp(c, vec3f(0.0), vec3f(1.0)); return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308)); }
@fragment fn fs(in : VOut) -> @location(0) vec4f {
  let f = textureSampleBaseClampToEdge(fgTex, smp, in.uv).rgb;
  let a = clamp(textureSample(aTex, smp, in.uv).r, 0.0, 1.0);
  let b = textureSample(bgTex, smp, in.uv).rgb;
  return vec4f(toSrgb(a * toLin(f) + (1.0 - a) * toLin(b)), 1.0);
}`;

  function enabled() { try { return localStorage.getItem('vs_webgpu_composite') === '1'; } catch (e) { return false; } }
  function isSupported() { return typeof navigator !== 'undefined' && !!navigator.gpu && enabled(); }

  async function create(canvas) {
    if (!isSupported() || !canvas) return null;
    try {
      const adapter = await navigator.gpu.requestAdapter(); if (!adapter) return null;
      const device = await adapter.requestDevice(), ctx = canvas.getContext('webgpu'); if (!ctx) return null;
      const format = navigator.gpu.getPreferredCanvasFormat(); ctx.configure({ device, format, alphaMode: 'opaque' });
      const module = device.createShaderModule({ code: WGSL });
      const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
      const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      let aTex = null, bTex = null, aKey = '', bKey = '', lost = false;
      device.lost.then(() => { lost = true; });
      const tex = (w, h) => device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      function upload(src, cur, key) {   // textures are reused while the size is unchanged (mandate: reuse allocations, no per-frame create)
        const w = src.videoWidth || src.width, h = src.videoHeight || src.height, k = w + 'x' + h;
        if (!cur || key !== k) { if (cur) cur.destroy(); cur = tex(w, h); }
        device.queue.copyExternalImageToTexture({ source: src }, { texture: cur }, [w, h]);
        return [cur, k];
      }
      return {
        backend: 'webgpu',
        draw(fg, alpha, bg) {
          if (lost) throw new Error('webgpu device lost');
          [aTex, aKey] = upload(alpha, aTex, aKey); [bTex, bKey] = upload(bg, bTex, bKey);
          const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: sampler }, { binding: 1, resource: device.importExternalTexture({ source: fg }) }, { binding: 2, resource: aTex.createView() }, { binding: 3, resource: bTex.createView() }] });
          const enc = device.createCommandEncoder(), pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
          pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end(); device.queue.submit([enc.finish()]);
        },
        dispose() { try { if (aTex) aTex.destroy(); if (bTex) bTex.destroy(); device.destroy(); } catch (e) { /* already gone */ } aTex = bTex = null; }
      };
    } catch (e) { return null; }
  }

  const api = { create, isSupported, compositeCPU, srgbToLin, linToSrgb, WGSL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {};
  root.VS.GpuComposite = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
