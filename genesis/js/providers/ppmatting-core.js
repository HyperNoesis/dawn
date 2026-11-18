/**
 * PP-Matting core (v0.94): pure functions, no DOM, no onnxruntime import, so the exact same code runs in the browser, in a worker and in node tests.
 *
 * Contract of the real models (checked against yakhyo/ppmatting weights with onnxruntime, see docs/PPMATTING_SEGMENTATION_NEXT.md):
 *   input  "img"   float32 [batch, 3, H, W]  RGB, (x/255 - 0.5) / 0.5  ->  range [-1, 1]; H and W must be multiples of 32
 *   output "alpha" float32 [batch, 1, H, W]  matte in [0, 1]
 * Upstream preprocessing (PaddleSeg val transforms): shrink so the SHORT side is <= 512 (never upscale), then floor both sides to a multiple of 32.
 */
(function (root) {
  'use strict';
  const MULT = 32, MAX_SHORT = 512;

  /** Upstream still-image size rule (LimitShort + ResizeToIntMult). Returns [w, h] or null when the image is smaller than 32 px. */
  function stillSize(w, h, maxShort, mult) {
    const m = mult || MULT, ms = maxShort || MAX_SHORT;
    if (!(w >= m && h >= m)) return null;
    let rw = w, rh = h;
    const short = Math.min(w, h);
    if (short > ms) { const s = ms / short; rw = Math.round(w * s); rh = Math.round(h * s); }
    rw -= rw % m; rh -= rh % m;
    return [Math.max(m, rw), Math.max(m, rh)];
  }

  /** Live size: long edge budget (px) from the quality mode, rounded to a multiple of 32, never above the still-image size rule. */
  function liveSize(vw, vh, longEdge, mult) {
    const m = mult || MULT;
    const scale = Math.min(1, longEdge / Math.max(vw, vh));
    let w = Math.max(m, Math.round((vw * scale) / m) * m), h = Math.max(m, Math.round((vh * scale) / m) * m);
    const cap = stillSize(Math.max(vw, m), Math.max(vh, m), MAX_SHORT, m);   // the models were trained with short side <= 512
    if (cap) { w = Math.min(w, cap[0]); h = Math.min(h, cap[1]); }
    return [w, h];
  }

  /** RGBA bytes (w*h*4) -> Float32 CHW [1,3,h,w] in [-1,1]. `out` is reused when it has the right length. */
  function toTensor(rgba, w, h, out) {
    const n = w * h, buf = out && out.length === 3 * n ? out : new Float32Array(3 * n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      buf[i] = rgba[j] / 127.5 - 1;
      buf[n + i] = rgba[j + 1] / 127.5 - 1;
      buf[2 * n + i] = rgba[j + 2] / 127.5 - 1;
    }
    return buf;
  }

  /** Model output floats -> Uint8 alpha. Clamps to [0,1]; NaN becomes 0. Writes into `dst` when given. */
  function toAlpha(data, n, dst) {
    const a = dst && dst.length === n ? dst : new Uint8Array(n);
    for (let i = 0; i < n; i++) { const v = data[i]; a[i] = !(v > 0) ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0; }
    return a;
  }

  /** Bilinear resize of a Uint8 alpha plane (sw x sh) -> (dw x dh), half-pixel centres like cv2.resize INTER_LINEAR. */
  function resizeAlpha(src, sw, sh, dw, dh, dst) {
    const out = dst && dst.length === dw * dh ? dst : new Uint8Array(dw * dh);
    if (sw === dw && sh === dh) { out.set(src); return out; }
    const rx = sw / dw, ry = sh / dh;
    for (let y = 0; y < dh; y++) {
      let fy = (y + 0.5) * ry - 0.5; if (fy < 0) fy = 0;
      const y0 = Math.min(sh - 1, fy | 0), y1 = Math.min(sh - 1, y0 + 1), wy = fy - y0;
      for (let x = 0; x < dw; x++) {
        let fx = (x + 0.5) * rx - 0.5; if (fx < 0) fx = 0;
        const x0 = Math.min(sw - 1, fx | 0), x1 = Math.min(sw - 1, x0 + 1), wx = fx - x0;
        const top = src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx;
        const bot = src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx;
        out[y * dw + x] = (top * (1 - wy) + bot * wy + 0.5) | 0;
      }
    }
    return out;
  }

  /** Composite helper for the lab/export: RGBA cutout = source RGB + alpha plane (same size). Straight (non-premultiplied) alpha. */
  function applyAlphaToRGBA(rgba, alpha, out) {
    const o = out && out.length === rgba.length ? out : new Uint8ClampedArray(rgba.length);
    for (let i = 0, j = 0; i < alpha.length; i++, j += 4) { o[j] = rgba[j]; o[j + 1] = rgba[j + 1]; o[j + 2] = rgba[j + 2]; o[j + 3] = alpha[i]; }
    return o;
  }

  /** Cheap sanity check on a model output, used by the release gate: a matte that is entirely empty or entirely full on a real camera frame is suspicious. */
  function coverage(alpha) {
    let s = 0; for (let i = 0; i < alpha.length; i++) s += alpha[i];
    return alpha.length ? s / (255 * alpha.length) : 0;
  }

  const api = { MULT, MAX_SHORT, stillSize, liveSize, toTensor, toAlpha, resizeAlpha, applyAlphaToRGBA, coverage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {};
  root.VS.PPMattingCore = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
