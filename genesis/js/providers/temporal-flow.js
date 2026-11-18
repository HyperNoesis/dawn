/**
 * MotionTemporalMatte (v0.98, mandate section 5, OPT-IN): motion-aware temporal fusion for frame-by-frame matting models.
 *
 * TemporalMatte blends each pixel with the SAME pixel of the previous matte. When the subject moves, the old edge sits at the wrong place, so it
 * has to switch smoothing off wherever anything moved. This module instead ESTIMATES the motion (pyramidal Lucas-Kanade on the camera luma, per
 * 8 px block), WARPS the previous refined alpha into the current frame, and only then fuses. A moving edge is therefore compared with where it
 * has moved to, not where it was.
 *
 *   - history weight is capped (opts.maxHistory, default 0.25, per the mandate) and scaled per pixel by flow confidence
 *   - confidence = photometric agreement between the current luma and the warped previous luma (low where occluded, newly visible or the flow failed)
 *   - where the warped alpha and the current model alpha disagree strongly, the current model output wins outright
 *   - reset (history dropped, raw returned) on: size change, timestamp gap, scene cut, explicit reset()
 *   - the RAW model output is never modified; step() returns { raw, refined, stats }; no spatial blur, so thin hair / finger gaps cannot be filled in
 *
 *   const mt = VS.MotionTemporalMatte.create();
 *   const { raw, refined, stats } = mt.step(alphaUint8, lumaUint8, w, h, tsMs);   // luma = camera frame at the SAME size as the matte
 *   mt.reset();   // camera switch / orientation / engine change / model restart / camera stop-start
 */
(function (root) {
  'use strict';
  const DEFAULTS = {
    maxHistory: 0.25,   // mandate: conservative cap on the history contribution, tune on labelled footage
    block: 8,           // LK block size in px of each pyramid level
    levels: 3,          // pyramid levels (coarsest = 1/4 resolution)
    iters: 3,           // LK iterations per level
    maxFlow: 24,        // px at matte resolution; larger is treated as a failed estimate
    minTexture: 40,     // minimum structure-tensor determinant per px^2 (scaled) for a block to produce its own flow
    residLo: 0.04,      // photometric residual (0..1) below which flow is fully trusted
    residHi: 0.16,      // ... and above which history is dropped
    alphaLo: 12,        // |cur - warped| (0..255) below which history is used fully
    alphaHi: 48,        // ... and above which the current matte is taken as is
    cutLuma: 0.22,      // mean |luma change| (0..1) that counts as a scene cut
    gapMs: 250          // longer than this between frames: history is stale
  };

  function down2(src, w, h) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), out = new Uint8Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const x0 = Math.min(w - 1, 2 * x), x1 = Math.min(w - 1, 2 * x + 1), y0 = Math.min(h - 1, 2 * y), y1 = Math.min(h - 1, 2 * y + 1);
      out[y * nw + x] = (src[y0 * w + x0] + src[y0 * w + x1] + src[y1 * w + x0] + src[y1 * w + x1] + 2) >> 2;
    }
    return { d: out, w: nw, h: nh };
  }
  function pyramid(luma, w, h, levels) {
    const p = [{ d: luma, w, h }];
    for (let l = 1; l < levels; l++) { const c = p[l - 1]; if (c.w < 16 || c.h < 16) break; p.push(down2(c.d, c.w, c.h)); }
    return p;
  }
  function bil(d, w, h, x, y) {
    if (x < 0) x = 0; else if (x > w - 1) x = w - 1; if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
    const x0 = x | 0, y0 = y | 0, x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0, fx = x - x0, fy = y - y0;
    const a = d[y0 * w + x0], b = d[y0 * w + x1], c = d[y1 * w + x0], e = d[y1 * w + x1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy;
  }

  /** One pyramid level of block LK. flow = { bw, bh, fx, fy } initial (already scaled to this level); updated in place. */
  function lkLevel(prev, cur, B, iters, flow, minTex, lim) {
    const { w, h } = cur, pd = prev.d, cd = cur.d, bw = flow.bw, bh = flow.bh;
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const bi = by * bw + bx, x0 = bx * B, y0 = by * B, x1 = Math.min(w, x0 + B), y1 = Math.min(h, y0 + B);
      let fx = flow.fx[bi], fy = flow.fy[bi], ok = flow.ok[bi];
      for (let it = 0; it < iters; it++) {
        let a = 0, b = 0, c = 0, e1 = 0, e2 = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const px = x + fx, py = y + fy;
          const ix = (bil(pd, w, h, px + 1, py) - bil(pd, w, h, px - 1, py)) * 0.5, iy = (bil(pd, w, h, px, py + 1) - bil(pd, w, h, px, py - 1)) * 0.5;
          const e = cd[y * w + x] - bil(pd, w, h, px, py);
          a += ix * ix; b += ix * iy; c += iy * iy; e1 += ix * e; e2 += iy * e; n++;
        }
        const det = a * c - b * b;
        if (n === 0 || det < minTex * n * n * 0.01 || a + c < 1e-3 * n) { ok = ok || 0; break; }   // flat block (or an edge with the aperture problem): keep the inherited flow
        const dx = (c * e1 - b * e2) / det, dy = (a * e2 - b * e1) / det;
        fx += dx; fy += dy; ok = 1;
        if (Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02) break;
      }
      const m = lim; fx = fx < -m ? -m : fx > m ? m : fx; fy = fy < -m ? -m : fy > m ? m : fy;
      flow.fx[bi] = fx; flow.fy[bi] = fy; flow.ok[bi] = ok;
    }
  }

  function create(options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    let w = 0, h = 0, prevAlpha = null, prevLuma = null, prevPyr = null, lastTs = -1, frames = 0, refined = null, warpedA = null, warpedL = null;

    function reset() { w = h = 0; prevAlpha = prevLuma = prevPyr = refined = warpedA = warpedL = null; lastTs = -1; frames = 0; }

    /** Backward flow field (cur pixel -> position in prev) on the finest level, one vector per block. */
    function estimate(curPyr) {
      let flow = null;
      for (let l = curPyr.length - 1; l >= 0; l--) {
        const c = curPyr[l], p = prevPyr[l], B = o.block, bw = Math.ceil(c.w / B), bh = Math.ceil(c.h / B);
        const nf = { bw, bh, fx: new Float32Array(bw * bh), fy: new Float32Array(bw * bh), ok: new Uint8Array(bw * bh) };
        if (flow) for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {   // inherit from the parent level (x2) at the block's centre
          const pbx = Math.min(flow.bw - 1, ((bx * B + B / 2) / 2 / B) | 0), pby = Math.min(flow.bh - 1, ((by * B + B / 2) / 2 / B) | 0), pi = pby * flow.bw + pbx, i = by * bw + bx;
          nf.fx[i] = flow.fx[pi] * 2; nf.fy[i] = flow.fy[pi] * 2; nf.ok[i] = flow.ok[pi];
        }
        lkLevel(p, c, B, o.iters, nf, o.minTexture, o.maxFlow / (1 << l));
        flow = nf;
      }
      return flow;
    }

    function step(cur, luma, cw, ch, ts) {
      const n = cw * ch;
      const t = typeof ts === 'number' ? ts : -1;
      let reason = '';
      if (!prevAlpha || !prevLuma || !prevPyr || w !== cw || h !== ch || prevAlpha.length !== n || !luma || luma.length !== n) reason = prevAlpha && prevLuma ? 'size' : 'first';
      else if (t >= 0 && lastTs >= 0 && (t - lastTs > o.gapMs || t < lastTs)) reason = 'gap';
      else {
        let s = 0; const stp = Math.max(1, (n / 4096) | 0), c0 = (n / stp) | 0;
        for (let i = 0; i < n; i += stp) s += Math.abs(luma[i] - prevLuma[i]);
        if (s / (c0 * 255) > o.cutLuma) reason = 'cut';
      }
      if (reason) {
        w = cw; h = ch; refined = Uint8Array.from(cur); prevAlpha = Uint8Array.from(cur);
        prevLuma = luma && luma.length === n ? Uint8Array.from(luma) : null;
        prevPyr = prevLuma ? pyramid(prevLuma, w, h, o.levels) : null;
        warpedA = new Uint8Array(n); warpedL = new Uint8Array(n); lastTs = t; frames = 1;
        return { raw: cur, refined, stats: { frame: 1, reset: reason, history: 0, meanFlow: 0, used: 0 } };
      }
      const curPyr = pyramid(luma, w, h, o.levels);
      const flow = estimate(curPyr), B = o.block, bw = flow.bw, bh = flow.bh;
      let hist = 0, used = 0, flowSum = 0;
      const resSpan = o.residHi - o.residLo, aSpan = o.alphaHi - o.alphaLo;
      for (let y = 0; y < h; y++) {
        // bilinear interpolation of the block flows (block centres) so the field is smooth across block borders
        const gy = (y + 0.5) / B - 0.5, gy0 = Math.max(0, Math.min(bh - 1, Math.floor(gy))), gy1 = Math.min(bh - 1, gy0 + 1), ty = Math.max(0, Math.min(1, gy - gy0));
        for (let x = 0; x < w; x++) {
          const gx = (x + 0.5) / B - 0.5, gx0 = Math.max(0, Math.min(bw - 1, Math.floor(gx))), gx1 = Math.min(bw - 1, gx0 + 1), tx = Math.max(0, Math.min(1, gx - gx0));
          const i00 = gy0 * bw + gx0, i01 = gy0 * bw + gx1, i10 = gy1 * bw + gx0, i11 = gy1 * bw + gx1;
          const fx = (flow.fx[i00] * (1 - tx) + flow.fx[i01] * tx) * (1 - ty) + (flow.fx[i10] * (1 - tx) + flow.fx[i11] * tx) * ty;
          const fy = (flow.fy[i00] * (1 - tx) + flow.fy[i01] * tx) * (1 - ty) + (flow.fy[i10] * (1 - tx) + flow.fy[i11] * tx) * ty;
          const px = x + fx, py = y + fy, i = y * w + x, c = cur[i];
          flowSum += Math.abs(fx) + Math.abs(fy);
          if (px < 0 || py < 0 || px > w - 1 || py > h - 1) { refined[i] = c; continue; }   // pulled in from outside the old frame: no history
          const wl = bil(prevLuma, w, h, px, py), resid = Math.abs(luma[i] - wl) / 255;
          const conf = resid <= o.residLo ? 1 : resid >= o.residHi ? 0 : 1 - (resid - o.residLo) / resSpan;
          const wa = bil(prevAlpha, w, h, px, py), d = Math.abs(c - wa);
          const agree = d <= o.alphaLo ? 1 : d >= o.alphaHi ? 0 : 1 - (d - o.alphaLo) / aSpan;
          const hw = o.maxHistory * conf * agree;
          refined[i] = (c + (wa - c) * hw + 0.5) | 0;
          hist += hw; if (hw > 0.01) used++;
        }
      }
      prevAlpha.set(refined); prevLuma.set(luma); prevPyr = curPyr; lastTs = t; frames++;
      return { raw: cur, refined, stats: { frame: frames, reset: '', history: hist / n, meanFlow: flowSum / (2 * n), used: used / n } };
    }

    return { step, reset, options: o };
  }

  const api = { create, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {};
  root.VS.MotionTemporalMatte = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
