/**
 * BandRefineCore (v0.99, beta): pure functions for the Genesis hybrid matte engine. No DOM, no onnx, so the same code runs in the
 * browser and in node tests.
 *
 *   buildBand / feather        uncertainty band around hair, fingers and soft edges (where alpha is neither 0 nor 255, or jumps)
 *   pickTiles / cropRect       which 128 px cores of the matte touch the band, and the 192 px input crop (core + context margin) for each
 *   mergeCore / tileSane       write a refined tile back ONLY inside the feathered band; reject a tile that contradicts confident pixels
 *   blockMotion / warpAlpha    cheap low-resolution block motion (SAD search) and a shift-warp of the previous alpha
 *   gatedTemporal              blend the warped previous alpha in with weight <= 0.25, only where motion is reliable and the change is small
 *   tileBudget                 how many tiles this frame can afford (adaptive governor)
 *
 * Rules: nothing outside the band is ever modified by tile refinement; a big change always follows the new value at once.
 */
(function (root) {
  'use strict';
  const HIST_CAP = 0.25;

  function dilate(mask, w, h, r) {
    if (!(r > 0)) return Uint8Array.from(mask);
    const n = w * h, t = new Uint8Array(n), out = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      const row = y * w; let last = -1e9;
      for (let x = 0; x < w; x++) { if (mask[row + x]) last = x; t[row + x] = x - last <= r ? 1 : 0; }
      last = 1e9;
      for (let x = w - 1; x >= 0; x--) { if (mask[row + x]) last = x; if (last - x <= r) t[row + x] = 1; }
    }
    for (let x = 0; x < w; x++) {
      let last = -1e9;
      for (let y = 0; y < h; y++) { if (t[y * w + x]) last = y; out[y * w + x] = y - last <= r ? 1 : 0; }
      last = 1e9;
      for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) last = y; if (last - y <= r) out[y * w + x] = 1; }
    }
    return out;
  }

  /** 1 = in band. Soft pixels (lo < a < hi) plus pixels at a hard jump (> grad between neighbours), grown by `dilate` px. */
  function buildBand(alpha, w, h, opt) {
    opt = opt || {};
    const lo = opt.lo != null ? opt.lo : 12, hi = opt.hi != null ? opt.hi : 243, grad = opt.grad != null ? opt.grad : 64;
    const r = opt.dilate != null ? opt.dilate : 3, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, a = alpha[i];
      if (a > lo && a < hi) m[i] = 1;
      if (x + 1 < w && Math.abs(a - alpha[i + 1]) > grad) { m[i] = 1; m[i + 1] = 1; }
      if (y + 1 < h && Math.abs(a - alpha[i + w]) > grad) { m[i] = 1; m[i + w] = 1; }
    }
    return dilate(m, w, h, r);
  }

  function count(mask) { let c = 0; for (let i = 0; i < mask.length; i++) c += mask[i] ? 1 : 0; return c; }

  /** 0/1 mask -> Uint8 0..255 weight, box blurred with radius r (clamped borders). Used so refined tiles fade in instead of stepping. */
  function feather(mask, w, h, r) {
    const n = w * h, out = new Uint8Array(n);
    if (!(r > 0)) { for (let i = 0; i < n; i++) out[i] = mask[i] ? 255 : 0; return out; }
    const tmp = new Float32Array(n), k = 2 * r + 1, cl = (v, m) => (v < 0 ? 0 : v > m ? m : v);
    for (let y = 0; y < h; y++) {
      const row = y * w; let s = 0;
      for (let x = -r; x <= r; x++) s += mask[row + cl(x, w - 1)];
      for (let x = 0; x < w; x++) { tmp[row + x] = s; s += mask[row + cl(x + r + 1, w - 1)] - mask[row + cl(x - r, w - 1)]; }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[cl(y, h - 1) * w + x];
      for (let y = 0; y < h; y++) { out[y * w + x] = Math.round(s / (k * k) * 255); s += tmp[cl(y + r + 1, h - 1) * w + x] - tmp[cl(y - r, h - 1) * w + x]; }
    }
    return out;
  }

  /** Grid of `tile` px cores that contain at least minCount band pixels, busiest first. */
  function pickTiles(band, w, h, tile, opt) {
    opt = opt || {};
    const minCount = opt.minCount != null ? opt.minCount : 24, maxTiles = opt.maxTiles != null ? opt.maxTiles : Infinity, list = [];
    for (let ty = 0; ty * tile < h; ty++) for (let tx = 0; tx * tile < w; tx++) {
      const x0 = tx * tile, y0 = ty * tile, tw = Math.min(tile, w - x0), th = Math.min(tile, h - y0);
      let c = 0;
      for (let y = 0; y < th; y++) { const row = (y0 + y) * w + x0; for (let x = 0; x < tw; x++) c += band[row + x]; }
      if (c >= minCount) list.push({ x: x0, y: y0, w: tw, h: th, count: c, key: tx + ',' + ty });
    }
    list.sort((a, b) => b.count - a.count);
    return list.slice(0, maxTiles);
  }

  /** size x size crop around a core with `margin` px of context, shifted inward at the image border. Needs w,h >= size. */
  function cropRect(core, margin, w, h, size) {
    const x = Math.max(0, Math.min(core.x - margin, w - size)), y = Math.max(0, Math.min(core.y - margin, h - size));
    return { x, y, w: size, h: size };
  }

  function extract(src, core, w) {
    const out = new Uint8Array(core.w * core.h);
    for (let y = 0; y < core.h; y++) { const so = (core.y + y) * w + core.x; out.set(src.subarray(so, so + core.w), y * core.w); }
    return out;
  }

  function meanAbsDiff(a, b) {
    const n = Math.min(a.length, b.length); if (!n) return 0;
    let s = 0; for (let i = 0; i < n; i++) s += a[i] > b[i] ? a[i] - b[i] : b[i] - a[i];
    return s / n;
  }

  /** Writes refined core pixels into dst, weighted by the feathered band (0 outside the band: those pixels are untouched). */
  function mergeCore(dst, refined, core, soft, w) {
    for (let y = 0; y < core.h; y++) for (let x = 0; x < core.w; x++) {
      const gi = (core.y + y) * w + core.x + x, s = soft[gi]; if (!s) continue;
      const r = refined[y * core.w + x], d = dst[gi];
      dst[gi] = Math.round(d + (r - d) * s / 255);
    }
  }

  /** A tile that flips many confident pixels is a bad run (wrong crop, garbage output): reject it. */
  function tileSane(coarseCore, refinedCore, maxFlip) {
    const lim = maxFlip != null ? maxFlip : 0.1, n = coarseCore.length; if (!n || refinedCore.length !== n) return false;
    let conf = 0, flip = 0;
    for (let i = 0; i < n; i++) {
      const c = coarseCore[i], r = refinedCore[i];
      if (r !== r) return false;
      if (c <= 12 || c >= 243) { conf++; if ((c > r ? c - r : r - c) > 128) flip++; }
    }
    return conf === 0 || flip / n <= lim;
  }

  function lumaFromRGBA(rgba, w, h, out) {
    const n = w * h, o = out && out.length === n ? out : new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) o[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    return o;
  }

  /**
   * Block motion on low-res luma. Vector (vx,vy) means cur(x,y) ~ prev(x+vx, y+vy). A block only moves when its best SAD beats the zero-motion SAD
   * by the `zeroBias` factor, so flat or noisy blocks stay at (0,0). res = mean |luma error| per pixel of the chosen vector (reliability).
   */
  function blockMotion(prev, cur, w, h, opt) {
    opt = opt || {};
    const B = opt.block || 8, R = opt.range != null ? opt.range : 3, bias = opt.zeroBias != null ? opt.zeroBias : 0.9;
    const bw = Math.ceil(w / B), bh = Math.ceil(h / B), vx = new Int8Array(bw * bh), vy = new Int8Array(bw * bh), res = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const x0 = bx * B, y0 = by * B, x1 = Math.min(w, x0 + B), y1 = Math.min(h, y0 + B), cnt = (x1 - x0) * (y1 - y0);
      let best = Infinity, bdx = 0, bdy = 0, zero = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        let sad = 0;
        for (let y = y0; y < y1; y++) {
          let py = y + dy; py = py < 0 ? 0 : py >= h ? h - 1 : py;
          const crow = y * w, prow = py * w;
          for (let x = x0; x < x1; x++) { let px = x + dx; px = px < 0 ? 0 : px >= w ? w - 1 : px; const d = cur[crow + x] - prev[prow + px]; sad += d < 0 ? -d : d; }
        }
        if (dx === 0 && dy === 0) zero = sad;
        if (sad < best) { best = sad; bdx = dx; bdy = dy; }
      }
      if (best >= zero * bias) { bdx = 0; bdy = 0; best = zero; }
      const bi = by * bw + bx; vx[bi] = bdx; vy[bi] = bdy; res[bi] = best / cnt;
    }
    return { vx, vy, res, bw, bh, block: B };
  }

  /** Shift each alpha pixel by its block's vector (scaled from luma to alpha resolution). */
  function warpAlpha(prev, aw, ah, mot, lw, lh, out) {
    const o = out && out.length === aw * ah ? out : new Uint8Array(aw * ah), sx = aw / lw, sy = ah / lh, B = mot.block;
    for (let y = 0; y < ah; y++) {
      const by = Math.min(mot.bh - 1, ((y / sy) / B) | 0);
      for (let x = 0; x < aw; x++) {
        const bi = by * mot.bw + Math.min(mot.bw - 1, ((x / sx) / B) | 0), vx = mot.vx[bi], vy = mot.vy[bi], i = y * aw + x;
        if (!vx && !vy) { o[i] = prev[i]; continue; }
        let px = x + Math.round(vx * sx), py = y + Math.round(vy * sy);
        px = px < 0 ? 0 : px >= aw ? aw - 1 : px; py = py < 0 ? 0 : py >= ah ? ah - 1 : py;
        o[i] = prev[py * aw + px];
      }
    }
    return o;
  }

  /**
   * In place on `cur`: blend the motion-compensated previous alpha `wp` with weight <= 0.25 where the block's luma match is reliable and the alpha
   * change is small. A change >= edgeHi (a strand or finger that really moved) follows the new value immediately. Returns { blended }.
   */
  function gatedTemporal(cur, wp, aw, ah, mot, lw, lh, opt) {
    opt = opt || {};
    const hist = Math.min(HIST_CAP, opt.hist != null ? opt.hist : HIST_CAP), edgeLo = opt.edgeLo != null ? opt.edgeLo : 6, edgeHi = opt.edgeHi != null ? opt.edgeHi : 40;
    const resHi = opt.resHi != null ? opt.resHi : 14, sx = aw / lw, sy = ah / lh, B = mot.block;
    let blended = 0;
    for (let y = 0; y < ah; y++) {
      const by = Math.min(mot.bh - 1, ((y / sy) / B) | 0);
      for (let x = 0; x < aw; x++) {
        const bi = by * mot.bw + Math.min(mot.bw - 1, ((x / sx) / B) | 0);
        if (mot.res[bi] > resHi) continue;
        const i = y * aw + x, c = cur[i], p = wp[i]; if (c === p) continue;
        const d = c > p ? c - p : p - c; if (d >= edgeHi) continue;
        const k = d <= edgeLo ? 1 : 1 - (d - edgeLo) / (edgeHi - edgeLo), v = c + (p - c) * hist * k;
        cur[i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v); blended++;
      }
    }
    return { blended };
  }

  /** Tiles affordable this frame: (target - coarse cost) / tile cost, 0 when the coarse pass alone is over budget. */
  function tileBudget(o) {
    const room = o.targetMs - o.coarseMs;
    if (!(room > 0)) return 0;
    return Math.max(0, Math.min(o.maxTiles, Math.floor(room / Math.max(1, o.tileMs))));
  }

  const api = { HIST_CAP, dilate, buildBand, count, feather, pickTiles, cropRect, extract, meanAbsDiff, mergeCore, tileSane, lumaFromRGBA, blockMotion, warpAlpha, gatedTemporal, tileBudget };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {}; root.VS.BandRefineCore = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
