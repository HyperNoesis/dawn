/**
 * Matting metrics (v0.94), pure functions shared by the in-app lab (ppmatting-lab.html), the node tests and tools/matting-bench.
 * Alpha planes are Uint8Array (0..255), same size. The research brief asks for: SAD / MAD, gradient error, dtSSD / temporal error,
 * FPS + p50/p95 latency of the WHOLE pipeline, peak memory growth. Lower is better for every error metric.
 *
 * Honest note on the numbers: SAD (x1/1000 of alpha-in-[0,1] units, the convention of the matting papers) and MAD are exact.
 * gradientError is a Sobel approximation, not the Gaussian-derivative implementation of the original papers, so compare engines with it
 * inside Genesis only, never against published tables. Scores from different datasets are not comparable either.
 */
(function (root) {
  'use strict';

  function check(a, g) { if (!a || !g || a.length !== g.length) throw new Error('alpha planes must have equal size'); }

  /** SAD in thousands of alpha units (paper convention), MAD (x1000 of mean abs error in 0..1), MSE (x1000). Optional trimap mask limits to unknown pixels (value 128). */
  function errors(pred, gt, trimap) {
    check(pred, gt);
    let sad = 0, se = 0, n = 0;
    for (let i = 0; i < pred.length; i++) {
      if (trimap && trimap[i] !== 128) continue;
      const d = (pred[i] - gt[i]) / 255; sad += Math.abs(d); se += d * d; n++;
    }
    return { sad: sad / 1000, mad: n ? (sad / n) * 1000 : 0, mse: n ? (se / n) * 1000 : 0, pixels: n };
  }

  /** Sobel gradient magnitude of a plane (0..255 in, float out). */
  function sobel(a, w, h) {
    const out = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -a[i - w - 1] - 2 * a[i - 1] - a[i + w - 1] + a[i - w + 1] + 2 * a[i + 1] + a[i + w + 1];
      const gy = -a[i - w - 1] - 2 * a[i - w] - a[i - w + 1] + a[i + w - 1] + 2 * a[i + w] + a[i + w + 1];
      out[i] = Math.sqrt(gx * gx + gy * gy) / (255 * 4);   // normalised so a full 0->1 step is about 1
    }
    return out;
  }

  /** Gradient error (Sobel approximation) in thousands: sum of squared gradient differences / 1000. */
  function gradientError(pred, gt, w, h) {
    check(pred, gt);
    const a = sobel(pred, w, h), b = sobel(gt, w, h);
    let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return s / 1000 * 100;     // x100 keeps typical values readable; relative comparison only
  }

  /** dtSSD (video matting papers): sqrt(mean((dPred - dGT)^2)) between consecutive frames, x100. Needs ground-truth sequences. */
  function dtSSD(predSeq, gtSeq) {
    if (predSeq.length !== gtSeq.length || predSeq.length < 2) throw new Error('need >= 2 frames of each');
    let s = 0, c = 0;
    for (let f = 1; f < predSeq.length; f++) {
      const p0 = predSeq[f - 1], p1 = predSeq[f], g0 = gtSeq[f - 1], g1 = gtSeq[f];
      for (let i = 0; i < p0.length; i++) { const d = ((p1[i] - p0[i]) - (g1[i] - g0[i])) / 255; s += d * d; c++; }
    }
    return Math.sqrt(s / c) * 100;
  }

  /** Temporal flicker without ground truth: mean |a_t - a_{t-1}| / 255 (x100) over pixels whose ground-truth-free "static" test passes: both frames within `still` levels of each other in the SOURCE luma. */
  function flicker(seq, lumaSeq, still) {
    if (seq.length < 2) return 0;
    const thr = still == null ? 6 : still;
    let s = 0, c = 0;
    for (let f = 1; f < seq.length; f++) {
      const a = seq[f - 1], b = seq[f], la = lumaSeq && lumaSeq[f - 1], lb = lumaSeq && lumaSeq[f];
      for (let i = 0; i < a.length; i++) {
        if (la && Math.abs(la[i] - lb[i]) > thr) continue;      // the picture itself moved here: that is motion, not flicker
        s += Math.abs(a[i] - b[i]); c++;
      }
    }
    return c ? (s / (c * 255)) * 100 : 0;
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const k = (sorted.length - 1) * p, lo = Math.floor(k), hi = Math.ceil(k);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
  }

  /** Latency stats from per-frame milliseconds of the whole pipeline (draw + model + refine + paint), not just inference. */
  function latency(msList) {
    const a = msList.filter((v) => isFinite(v)).slice().sort((x, y) => x - y);
    if (!a.length) return { n: 0, mean: 0, p50: 0, p95: 0, max: 0, fps: 0 };
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    return { n: a.length, mean, p50: percentile(a, 0.5), p95: percentile(a, 0.95), max: a[a.length - 1], fps: mean > 0 ? 1000 / mean : 0 };
  }

  const api = { errors, gradientError, dtSSD, flicker, latency, percentile, sobel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {};
  root.VS.MattingMetrics = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
