/**
 * MatteBand (v0.99, pipeline task 1): decides WHERE a matting frame is uncertain, so the heavy refinement pass runs only there.
 * PURE (no DOM, no model): unit-tested in tools/unit/matte-band.test.js.
 *
 * A pixel is uncertain when (a) its alpha sits in the middle range (hair, fingers, soft clothing edge), or
 * (b) the matte and an optional tracker mask disagree about inside/outside (leaks, other people).
 * The frame is cut into square tiles; each tile scores by its uncertain-pixel count; the top tiles (within a per-frame budget) are returned
 * as padded rectangles in matte pixels. Cost therefore follows edge area, not frame area.
 *
 *   const plan = VS.MatteBand.plan(alphaU8, w, h, { tracker: maskU8OrNull, tile: 64, budget: 6 });
 *   plan.tiles  -> [{ x, y, w, h, score }]  (score = uncertain pixels / tile area, 0..1; best first; clipped to the frame)
 *   plan.stats  -> { uncertainPct, tilesTotal, tilesPicked, coveragePct, disagreePct }
 */
(function (root) {
  'use strict';
  const DEFAULTS = {
    lo: 20, hi: 235,        // alpha range counted as "soft" (0..255)
    thr: 128,               // inside/outside threshold for the tracker disagreement test
    tile: 64,               // tile edge in matte pixels
    pad: 8,                 // each picked tile grows by this many px so the refined crop has context at its borders
    minScore: 0.02,         // a tile needs at least 2% uncertain pixels to be worth a pass
    budget: 6,              // max tiles per frame (the governor lowers this on weak/hot devices)
    mergeGap: 0             // 0 = keep tiles separate (simple, predictable cost)
  };

  function plan(alpha, w, h, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const T = Math.max(8, o.tile | 0), tx = Math.ceil(w / T), ty = Math.ceil(h / T), n = tx * ty;
    const soft = new Uint32Array(n), dis = new Uint32Array(n), tr = o.tracker && o.tracker.length === w * h ? o.tracker : null;
    let uncertain = 0, disagree = 0;
    for (let y = 0; y < h; y++) {
      const row = y * w, trow = ((y / T) | 0) * tx;
      for (let x = 0; x < w; x++) {
        const a = alpha[row + x], t = trow + ((x / T) | 0);
        let u = a > o.lo && a < o.hi;
        if (tr) { const d = (a >= o.thr) !== (tr[row + x] >= o.thr); if (d) { dis[t]++; disagree++; u = true; } }
        if (u) { soft[t]++; uncertain++; }
      }
    }
    const cand = [];
    for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) {
      const x0 = i * T, y0 = j * T, tw = Math.min(T, w - x0), th = Math.min(T, h - y0), s = soft[j * tx + i] / (tw * th);
      if (s >= o.minScore) cand.push({ i, j, x0, y0, tw, th, score: s });
    }
    cand.sort((a, b) => b.score - a.score);
    const picked = cand.slice(0, Math.max(0, o.budget | 0)), P = o.pad | 0, tiles = [];
    let covered = 0;
    for (const c of picked) {
      const x = Math.max(0, c.x0 - P), y = Math.max(0, c.y0 - P), x1 = Math.min(w, c.x0 + c.tw + P), y1 = Math.min(h, c.y0 + c.th + P);
      tiles.push({ x, y, w: x1 - x, h: y1 - y, score: c.score }); covered += (x1 - x) * (y1 - y);
    }
    return { tiles, stats: { uncertainPct: uncertain / (w * h) * 100, disagreePct: disagree / (w * h) * 100, tilesTotal: n, tilesCandidate: cand.length, tilesPicked: tiles.length, coveragePct: Math.min(100, covered / (w * h) * 100) } };
  }

  /** Scale tile rectangles from one grid to another (matte grid -> full-resolution camera grid). Rounds to even pixels, stays inside the frame. */
  function scaleTiles(tiles, fromW, fromH, toW, toH) {
    const sx = toW / fromW, sy = toH / fromH, ev = (v) => Math.round(v / 2) * 2;
    return tiles.map((t) => {
      const x = Math.max(0, ev(t.x * sx)), y = Math.max(0, ev(t.y * sy));
      return { x, y, w: Math.max(2, Math.min(toW - x, ev(t.w * sx))), h: Math.max(2, Math.min(toH - y, ev(t.h * sy))), score: t.score };
    });
  }

  /** Blend a refined tile (alpha, tw x th) back into the full matte. A feathered border of `feather` px avoids visible seams. Returns the matte (in place). */
  function pasteTile(dst, w, h, tile, src, feather) {
    const F = Math.max(0, feather | 0);
    for (let y = 0; y < tile.h; y++) {
      const dy = tile.y + y; if (dy < 0 || dy >= h) continue;
      const fy = F ? Math.min(1, (Math.min(y, tile.h - 1 - y) + 1) / (F + 1)) : 1;
      for (let x = 0; x < tile.w; x++) {
        const dx = tile.x + x; if (dx < 0 || dx >= w) continue;
        const k = F ? fy * Math.min(1, (Math.min(x, tile.w - 1 - x) + 1) / (F + 1)) : 1, di = dy * w + dx;
        dst[di] = (dst[di] + (src[y * tile.w + x] - dst[di]) * k + 0.5) | 0;
      }
    }
    return dst;
  }

  /** Mean |coarse - fine| (0..1) over pixels the coarse matte was SURE about (alpha < 20 or > 235). A tile crop has no global context, so a refined
   *  tile that rewrites confident pixels is wrong and is rejected. Returns 0 when there are too few confident pixels to judge. */
  function disagreement(coarse, fine) {
    let sum = 0, n = 0;
    for (let i = 0; i < coarse.length; i++) { const c = coarse[i]; if (c < 20 || c > 235) { sum += Math.abs(c - fine[i]); n++; } }
    return n < 16 ? 0 : sum / n / 255;
  }
  function cropAlpha(a, w, t) { const o = new Uint8Array(t.w * t.h); for (let y = 0; y < t.h; y++) o.set(a.subarray((t.y + y) * w + t.x, (t.y + y) * w + t.x + t.w), y * t.w); return o; }

  /**
   * Run `runTile(tile) -> Promise<Uint8Array(tile.w*tile.h)>` on each tile and paste accepted results into a COPY of `raw` (raw is never modified).
   * opts: maxDiff (default 0.12, see disagreement), feather (default 6), deadlineMs (stop starting new tiles after this many ms; default Infinity), now (clock, default performance.now/Date.now).
   * A tile whose runner throws or returns the wrong size is skipped, never fatal.
   */
  async function refineTiles(raw, w, h, tiles, runTile, opts) {
    const o = Object.assign({ maxDiff: 0.12, feather: 6, deadlineMs: Infinity }, opts || {}), now = o.now || (typeof performance !== 'undefined' ? () => performance.now() : Date.now);
    const out = Uint8Array.from(raw), t0 = now(); let accepted = 0, rejected = 0, failed = 0, skipped = 0;
    for (const t of tiles) {
      if (now() - t0 > o.deadlineMs) { skipped++; continue; }
      let fine = null; try { fine = await runTile(t); } catch (e) { fine = null; }
      if (!fine || fine.length !== t.w * t.h) { failed++; continue; }
      if (disagreement(cropAlpha(raw, w, t), fine) > o.maxDiff) { rejected++; continue; }
      pasteTile(out, w, h, t, fine, o.feather); accepted++;
    }
    return { alpha: out, accepted, rejected, failed, skipped, ms: now() - t0 };
  }

  const api = { plan, scaleTiles, pasteTile, disagreement, refineTiles, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {}; root.VS.MatteBand = api;
})(typeof self !== 'undefined' ? self : this);
