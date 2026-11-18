/**
 * Foreground colour decontamination (v0.98, mandate section 7, OPT-IN, switchable for A/B).
 *
 * Problem: at a soft edge the camera pixel is a mix I = a*F + (1-a)*B of the person (F) and the OLD background (B). Compositing that pixel over a new
 * background drags the old background colour in as a halo (green spill, dark or bright fringe). This stage estimates F for boundary pixels only.
 *
 * Method: blur fusion (Forte 2021): F0 = blur(I*a)/blur(a), B0 = blur(I*(1-a))/blur(1-a), then
 *         F  = F0 + a*(I - a*F0 - (1-a)*B0)
 * Conservative by design:
 *   - only pixels with alphaLo < a < alphaHi are touched; solid interior, solid background and everything else is copied unchanged
 *   - a pixel needs BOTH enough foreground and enough background support in its neighbourhood (blur(a) and blur(1-a) >= minSupport), else it is unchanged
 *   - alpha below alphaLo is never divided by (unstable): those pixels are left alone
 *   - the correction is limited to maxShift per channel and blended by `strength` (0 = off), so a wrong estimate can only do bounded harm
 *   - no global colour shift: the correction depends only on the local boundary neighbourhood
 *   - alpha is NOT modified. This is an alpha-only model's best guess; it cannot recover the true foreground colour when the original
 *     background is unknown (mandate section 7), and nothing here claims exact reconstruction.
 *
 *   const out = VS.FgDecontaminate.run(rgba, alphaUint8, w, h, { strength: 0.8 });   // returns { rgba, stats }; input untouched
 *   opts.enabled === false returns the input unchanged (A/B switch).
 */
(function (root) {
  'use strict';
  const DEFAULTS = { enabled: true, strength: 0.8, radius: 4, alphaLo: 0.04, alphaHi: 0.97, minSupport: 0.08, maxShift: 60 };

  /** Separable box blur of a float plane (radius r, clamped edges) via running sums. */
  function boxBlur(src, w, h, r, tmp, out) {
    const k = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w; let s = 0;
      for (let x = -r; x <= r; x++) s += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = s / k;
        s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s / k;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  function run(rgba, alpha, w, h, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const n = w * h;
    if (!rgba || !alpha || alpha.length !== n || rgba.length < n * 4) return { rgba, stats: { touched: 0, skipped: 'bad-input' } };
    if (o.enabled === false || !(o.strength > 0)) return { rgba, stats: { touched: 0, skipped: 'off' } };
    const out = rgba instanceof Uint8ClampedArray ? new Uint8ClampedArray(rgba) : new Uint8Array(rgba);
    const a = new Float32Array(n), ia = new Float32Array(n);
    let any = false;
    for (let i = 0; i < n; i++) { const v = alpha[i] / 255; a[i] = v; ia[i] = 1 - v; if (v > o.alphaLo && v < o.alphaHi) any = true; }
    if (!any) return { rgba: out, stats: { touched: 0, skipped: 'no-boundary' } };
    const tmp = new Float32Array(n), ba = boxBlur(a, w, h, o.radius, tmp, new Float32Array(n)), bia = boxBlur(ia, w, h, o.radius, tmp, new Float32Array(n));
    const plane = new Float32Array(n), fN = [], bN = [];
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < n; i++) plane[i] = rgba[i * 4 + c] * a[i];
      fN.push(boxBlur(plane, w, h, o.radius, tmp, new Float32Array(n)));
      for (let i = 0; i < n; i++) plane[i] = rgba[i * 4 + c] * ia[i];
      bN.push(boxBlur(plane, w, h, o.radius, tmp, new Float32Array(n)));
    }
    let touched = 0, maxAbs = 0;
    for (let i = 0; i < n; i++) {
      const al = a[i];
      if (!(al > o.alphaLo && al < o.alphaHi) || ba[i] < o.minSupport || bia[i] < o.minSupport) continue;
      for (let c = 0; c < 3; c++) {
        const I = rgba[i * 4 + c], F0 = fN[c][i] / ba[i], B0 = bN[c][i] / bia[i];
        let F = F0 + al * (I - al * F0 - (1 - al) * B0);
        if (!isFinite(F)) continue;
        let d = F - I; d = d < -o.maxShift ? -o.maxShift : d > o.maxShift ? o.maxShift : d;
        const v = I + d * o.strength;
        out[i * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : v + 0.5;
        const ad = d < 0 ? -d : d; if (ad > maxAbs) maxAbs = ad;
      }
      touched++;
    }
    return { rgba: out, stats: { touched, maxShift: maxAbs, skipped: '' } };
  }

  const api = { run, boxBlur, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {};
  root.VS.FgDecontaminate = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
