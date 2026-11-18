/**
 * TemporalMask: motion-adaptive smoothing of a matte over time for single-frame models (BiRefNet, MODNet, EdgeTAM gates),
 * which have no memory of the previous frame and so shimmer at the edges. It works on the OUTPUT, so any pretrained model can use it.
 *   - pixel agrees with the previous frame -> blend toward the previous (kills edge shimmer)
 *   - pixel changed a lot (real motion)    -> take the new value (no ghosting)
 *   - whole frame moving (head turn)       -> follow the new alpha almost everywhere
 * fuse(state, cur): Uint8Array alphas (0..255). Returns a NEW array if there is no state / size changed, else updates `state` in place.
 */
(function (root) {
  'use strict';
  const DEFAULTS = { follow: 0.35, motionFollow: 0.85, motionHi: 0.06, edgeLo: 10, edgeHi: 48 };

  function motionAmount(prev, cur) {
    const n = cur.length;
    if (!prev || prev.length !== n || !n) return 1;
    const step = Math.max(1, (n / 4096) | 0);
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i += step) { sum += Math.abs(cur[i] - prev[i]); cnt++; }
    return sum / (cnt * 255);
  }

  function fuse(state, cur, opts) {
    const o = opts ? Object.assign({}, DEFAULTS, opts) : DEFAULTS;
    const n = cur.length;
    if (!state || state.length !== n) return Uint8Array.from(cur);
    const m = Math.min(1, motionAmount(state, cur) / o.motionHi);
    const base = o.follow + (o.motionFollow - o.follow) * m;
    const span = o.edgeHi - o.edgeLo;
    for (let i = 0; i < n; i++) {
      const p = state[i], c = cur[i];
      const d = c > p ? c - p : p - c;
      if (d === 0) continue;
      const k = d <= o.edgeLo ? 0 : d >= o.edgeHi ? 1 : (d - o.edgeLo) / span;
      const w = base + (1 - base) * k;
      let v = (p + (c - p) * w + 0.5) | 0;
      if (v === p) v = c > p ? p + 1 : p - 1;   // always make progress, else rounding strands the matte a level or two off target
      state[i] = v;
    }
    return state;
  }

  const api = { fuse, motionAmount, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {};
  root.VS.TemporalMask = api;
})(typeof window !== 'undefined' ? window : globalThis);
