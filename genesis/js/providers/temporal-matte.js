/**
 * TemporalMatte (v0.94): per-region temporal refinement for frame-by-frame matting models (PP-MattingV2, PP-Matting HRNet, MODNet...).
 *
 * Why not just reuse TemporalMask (temporal-mask.js)? TemporalMask measures motion for the WHOLE frame, so a head turn switches smoothing off
 * everywhere, including the static shoulders and background edges that keep shimmering. TemporalMatte measures motion per 16x16 block
 * (and its neighbours), so static regions stay smoothed while moving regions follow the new matte immediately.
 *
 * Rules (the research brief: "smoothing must not erase thin hair, gaps between fingers or fast-moving edges; keep raw and refined for A/B"):
 *   - the RAW model output is never modified: step() returns { raw, refined } so the caller can show or export either
 *   - a pixel that changed a lot follows the new value at once (fast edges, strands that really moved are not smeared)
 *   - a pixel that changed a little blends toward the previous refined value (kills edge shimmer) but always moves at least one level toward the new value
 *   - it only ever blends two real values of the same pixel; there is no spatial blur, so a one-pixel hair or the gap between two fingers cannot be filled in
 *
 *   const tm = VS.TemporalMatte.create();
 *   const { raw, refined, stats } = tm.step(alphaUint8, w, h);   // refined is owned by tm (copy it if you keep it)
 *   tm.reset();   // on camera restart / engine switch
 */
(function (root) {
  'use strict';
  const DEFAULTS = {
    block: 16,          // motion measurement block (px of the matte)
    follow: 0.35,       // blend toward new value for tiny changes in a static block
    motionFollow: 0.9,  // blend toward new value inside a moving block
    motionHi: 0.05,     // mean |delta|/255 in a block at which it counts as fully moving
    edgeLo: 10,         // |delta| (0..255) below this is treated as noise
    edgeHi: 40          // |delta| above this follows the new value at once
  };

  function create(options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    let w = 0, h = 0, refined = null, blockW = 0, blockH = 0, bm = null, bw = null, frames = 0;

    function reset() { w = h = 0; refined = null; bm = bw = null; frames = 0; }

    /** Per-block mean |cur - prev| / 255, then a 3x3 max so the border of a moving region also follows. Returns the per-block follow weight. */
    function blockWeights(cur) {
      const B = o.block;
      bm.fill(0);
      const cnt = new Float32Array(bm.length);
      for (let y = 0; y < h; y++) {
        const by = ((y / B) | 0) * blockW, row = y * w;
        for (let x = 0; x < w; x++) {
          const d = cur[row + x] - refined[row + x];
          const bi = by + ((x / B) | 0);
          bm[bi] += d < 0 ? -d : d; cnt[bi]++;
        }
      }
      for (let i = 0; i < bm.length; i++) bm[i] = cnt[i] ? bm[i] / (cnt[i] * 255) : 0;
      let maxMotion = 0;
      for (let by = 0; by < blockH; by++) for (let bx = 0; bx < blockW; bx++) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = by + dy, xx = bx + dx;
          if (yy < 0 || xx < 0 || yy >= blockH || xx >= blockW) continue;
          const v = bm[yy * blockW + xx]; if (v > m) m = v;
        }
        const k = Math.min(1, m / o.motionHi);
        bw[by * blockW + bx] = o.follow + (o.motionFollow - o.follow) * k;
        if (m > maxMotion) maxMotion = m;
      }
      return maxMotion;
    }

    function step(cur, cw, ch) {
      const n = cw * ch;
      if (!refined || w !== cw || h !== ch || refined.length !== n) {
        w = cw; h = ch; refined = Uint8Array.from(cur);
        blockW = Math.ceil(w / o.block); blockH = Math.ceil(h / o.block);
        bm = new Float32Array(blockW * blockH); bw = new Float32Array(blockW * blockH);
        frames = 1;
        return { raw: cur, refined, stats: { frame: 1, motion: 1, changed: n } };
      }
      const maxMotion = blockWeights(cur), B = o.block, span = o.edgeHi - o.edgeLo;
      let changed = 0;
      for (let y = 0; y < h; y++) {
        const by = ((y / B) | 0) * blockW, row = y * w;
        for (let x = 0; x < w; x++) {
          const i = row + x, p = refined[i], c = cur[i];
          if (p === c) continue;
          const d = c > p ? c - p : p - c;
          const base = bw[by + ((x / B) | 0)];
          const kk = d <= o.edgeLo ? 0 : d >= o.edgeHi ? 1 : (d - o.edgeLo) / span;
          const wgt = base + (1 - base) * kk;
          let v = (p + (c - p) * wgt + 0.5) | 0;
          if (v === p) v = c > p ? p + 1 : p - 1;     // always make progress, else rounding strands the matte a level off target
          refined[i] = v; changed++;
        }
      }
      frames++;
      return { raw: cur, refined, stats: { frame: frames, motion: maxMotion, changed } };
    }

    return { step, reset, options: o };
  }

  /** Mean absolute frame-to-frame change (0..255) of a sequence of equally sized planes: the "flicker" number used by tests and the benchmark. */
  function flicker(frames) {
    let s = 0, c = 0;
    for (let f = 1; f < frames.length; f++) {
      const a = frames[f - 1], b = frames[f];
      for (let i = 0; i < a.length; i++) { s += a[i] > b[i] ? a[i] - b[i] : b[i] - a[i]; c++; }
    }
    return c ? s / c : 0;
  }

  const api = { create, flicker, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {};
  root.VS.TemporalMatte = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
