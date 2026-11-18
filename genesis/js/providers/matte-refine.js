/**
 * MatteRefine (v0.94): export-quality refinement helpers that run on CPU (stills and offline renders). The live compositor already has GPU
 * guided upsample + despill (gl-matte.js) and debris/wisp cleanup (mask-clean.js). These add what the research brief lists and v0.93 lacked
 * for exports: hole preservation, foreground colour estimation (decontamination) and a raw-vs-refined report. Pure functions, no DOM.
 *
 *   preserveHoles(raw, cleaned, w, h, {minHole})    -> Uint8Array: cleaned, except background gaps in `raw` that cleanup filled
 *                                                      (spaces between fingers, loops of hair, glasses frames) are put back
 *   estimateForeground(rgba, alpha, w, h, {radius}) -> Uint8ClampedArray RGBA: colours with the background contribution removed at edge pixels,
 *                                                      alpha unchanged (edge decontamination)
 *   compare(raw, refined, w, h)                     -> { changedPct, holesRestored..., hairKept } numbers for the A/B review
 * Nothing here blurs the matte. Raw is never modified.
 */
(function (root) {
  'use strict';

  /** Enclosed background components (8-neighbour flood fill from the border marks "outside"; the rest are holes). */
  function holeLabels(a, w, h, thr) {
    const n = w * h, out = new Uint8Array(n), stack = new Int32Array(n); let sp = 0;
    const push = (i) => { if (!out[i] && a[i] < thr) { out[i] = 1; stack[sp++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); } for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) push(yy * w + xx); } }
    }
    return out;   // 1 = outside background; background pixels with out==0 are enclosed holes
  }

  function preserveHoles(raw, cleaned, w, h, opt) {
    opt = opt || {}; const thr = opt.threshold || 128, minHole = opt.minHole != null ? opt.minHole : Math.max(12, Math.round(w * h * 0.0002));
    const n = w * h, outside = holeLabels(raw, w, h, thr), res = Uint8Array.from(cleaned), seen = new Uint8Array(n), stack = new Int32Array(n);
    let restored = 0, comps = 0;
    for (let s = 0; s < n; s++) {
      if (raw[s] >= thr || outside[s] || seen[s]) continue;
      let sp = 0, area = 0; const members = []; stack[sp++] = s; seen[s] = 1;
      while (sp) {
        const i = stack[--sp]; area++; members.push(i); const x = i % w, y = (i / w) | 0;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, j = yy * w + xx; if (xx >= 0 && xx < w && !seen[j] && raw[j] < thr && !outside[j]) { seen[j] = 1; stack[sp++] = j; } } }
      }
      if (area < minHole) continue;                        // tiny pinholes are the debris cleanup is allowed to fill
      let filled = 0; for (const i of members) if (cleaned[i] >= thr) filled++;
      if (filled / area > 0.5) { for (const i of members) res[i] = raw[i]; restored += area; comps++; }
    }
    return { alpha: res, holesRestored: comps, pixelsRestored: restored };
  }

  /**
   * Foreground colour at edge pixels. Observed C = a*F + (1-a)*B. B is estimated from nearby pixels that are confidently background
   * (a < 0.05, averaged inside `radius`), F = (C - (1-a)*B) / a, clamped; for tiny `a` it falls back to the nearest confident interior colour.
   */
  function estimateForeground(rgba, alpha, w, h, opt) {
    opt = opt || {}; const R = opt.radius || 6, n = w * h, out = new Uint8ClampedArray(rgba);
    // integral images of background colour sums and counts
    const W1 = w + 1, sr = new Float64Array(W1 * (h + 1)), sg = new Float64Array(W1 * (h + 1)), sb = new Float64Array(W1 * (h + 1)), sc = new Float64Array(W1 * (h + 1));
    const sf = [new Float64Array(W1 * (h + 1)), new Float64Array(W1 * (h + 1)), new Float64Array(W1 * (h + 1)), new Float64Array(W1 * (h + 1))];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, a = alpha[i], k = (y + 1) * W1 + x + 1, up = y * W1 + x + 1, lf = (y + 1) * W1 + x, dg = y * W1 + x, bgp = a < 13 ? 1 : 0, fgp = a > 242 ? 1 : 0;
      sr[k] = sr[up] + sr[lf] - sr[dg] + (bgp ? rgba[i * 4] : 0); sg[k] = sg[up] + sg[lf] - sg[dg] + (bgp ? rgba[i * 4 + 1] : 0); sb[k] = sb[up] + sb[lf] - sb[dg] + (bgp ? rgba[i * 4 + 2] : 0); sc[k] = sc[up] + sc[lf] - sc[dg] + bgp;
      sf[0][k] = sf[0][up] + sf[0][lf] - sf[0][dg] + (fgp ? rgba[i * 4] : 0); sf[1][k] = sf[1][up] + sf[1][lf] - sf[1][dg] + (fgp ? rgba[i * 4 + 1] : 0); sf[2][k] = sf[2][up] + sf[2][lf] - sf[2][dg] + (fgp ? rgba[i * 4 + 2] : 0); sf[3][k] = sf[3][up] + sf[3][lf] - sf[3][dg] + fgp;
    }
    const box = (S, x0, y0, x1, y1) => S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0];
    let edited = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, a8 = alpha[i]; if (a8 < 13 || a8 > 242) continue;           // only the soft edge band
      const a = a8 / 255; let r = R, nb = 0, nf = 0, x0, y0, x1, y1;
      for (let t = 0; t < 4 && (nb < 3 || nf < 3); t++, r *= 2) { x0 = Math.max(0, x - r); y0 = Math.max(0, y - r); x1 = Math.min(w, x + r + 1); y1 = Math.min(h, y + r + 1); nb = box(sc, x0, y0, x1, y1); nf = box(sf[3], x0, y0, x1, y1); }
      if (nb < 3 || nf < 3) continue;
      const B = [box(sr, x0, y0, x1, y1) / nb, box(sg, x0, y0, x1, y1) / nb, box(sb, x0, y0, x1, y1) / nb], Fn = [box(sf[0], x0, y0, x1, y1) / nf, box(sf[1], x0, y0, x1, y1) / nf, box(sf[2], x0, y0, x1, y1) / nf];
      const wgt = Math.min(1, Math.max(0, (a - 0.05) / 0.25));                           // very thin alpha: trust the neighbouring solid colour instead of dividing by ~0
      for (let c = 0; c < 3; c++) {
        const est = (rgba[i * 4 + c] - (1 - a) * B[c]) / a, f = wgt * est + (1 - wgt) * Fn[c];
        const lo = Math.min(Fn[c], rgba[i * 4 + c]) - 40, hi = Math.max(Fn[c], rgba[i * 4 + c]) + 40;   // never invent a colour far from what is observed or inside the subject
        out[i * 4 + c] = Math.max(lo, Math.min(hi, f));
      }
      edited++;
    }
    return { rgba: out, edited };
  }

  function compare(raw, refined, w, h) {
    const n = w * h; let changed = 0, sumd = 0, soft = 0, softKept = 0;
    for (let i = 0; i < n; i++) { const d = Math.abs(raw[i] - refined[i]); if (d > 8) changed++; sumd += d; if (raw[i] > 12 && raw[i] < 243) { soft++; if (refined[i] > 12 && refined[i] < 243) softKept++; } }
    return { changedPct: changed / n * 100, meanAbsDiff: sumd / n, fractionalPixels: soft, fractionalKeptPct: soft ? softKept / soft * 100 : 100 };
  }


  /**
   * keepMainSubject (v0.95): drop small false-positive blobs (stray shapes the network invents in the background). Components of the
   * thresholded matte smaller than minRel x the LARGEST component are removed; kept components keep their soft edges (a dilated keep-zone, so hair is
   * untouched). Evidence (P3M, 12 photos): PP-MattingV2 stray blobs were 1-3% of the subject, a real second object 12-15%, so the default 6% cuts the
   * blobs and keeps real second subjects; a genuinely tiny/distant second person (<6% of the main subject's area) WOULD be removed (use {minRel:0} to disable).
   */
  function keepMainSubject(alpha, w, h, opt) {
    opt = opt || {}; const minRel = opt.minRel != null ? opt.minRel : 0.06, thr = opt.threshold || 128, n = w * h;
    if (!(minRel > 0)) return { alpha, removed: 0, kept: 0 };
    const lab = new Int32Array(n), stack = new Int32Array(n), areas = [0]; let nl = 0;
    for (let s = 0; s < n; s++) {
      if (alpha[s] < thr || lab[s]) continue;
      nl++; let sp = 0, area = 0; stack[sp++] = s; lab[s] = nl;
      while (sp) {
        const i = stack[--sp]; area++; const x = i % w, y = (i / w) | 0;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, j = yy * w + xx; if (xx >= 0 && xx < w && alpha[j] >= thr && !lab[j]) { lab[j] = nl; stack[sp++] = j; } } }
      }
      areas.push(area);
    }
    if (nl <= 1) return { alpha, removed: 0, kept: nl };
    let big = 0; for (let k = 1; k <= nl; k++) if (areas[k] > big) big = areas[k];
    const keepL = new Uint8Array(nl + 1); let kept = 0; for (let k = 1; k <= nl; k++) if (areas[k] >= minRel * big) { keepL[k] = 1; kept++; }
    if (kept === nl) return { alpha, removed: 0, kept };
    const r = opt.radius != null ? opt.radius : Math.max(2, Math.round(Math.max(w, h) * 0.02));
    // keep-zone = kept components dilated by r (separable box dilation)
    let z = new Uint8Array(n); for (let i = 0; i < n; i++) z[i] = keepL[lab[i]];
    const t = new Uint8Array(n);
    for (let y = 0; y < h; y++) { let last = -1e9; const row = y * w; for (let x = 0; x < w; x++) { if (z[row + x]) last = x; t[row + x] = x - last <= r ? 1 : 0; } last = 1e9; for (let x = w - 1; x >= 0; x--) { if (z[row + x]) last = x; if (last - x <= r) t[row + x] = 1; } }
    const z2 = new Uint8Array(n);
    for (let x = 0; x < w; x++) { let last = -1e9; for (let y = 0; y < h; y++) { if (t[y * w + x]) last = y; z2[y * w + x] = y - last <= r ? 1 : 0; } last = 1e9; for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) last = y; if (last - y <= r) z2[y * w + x] = 1; } }
    const out = new Uint8Array(alpha); for (let i = 0; i < n; i++) if (!z2[i]) out[i] = 0;
    return { alpha: out, removed: nl - kept, kept };
  }

  const api = { preserveHoles, estimateForeground, compare, holeLabels, keepMainSubject };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {}; root.VS.MatteRefine = api;
})(typeof self !== 'undefined' ? self : this);
