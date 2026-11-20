import { boxMean, clamp01, smoothstep } from './util.js';

// Edge colour decontamination.
// For edge pixels the camera image is I = a*F + (1-a)*B. The old background B bleeds
// into the edge. We estimate B from nearby pure-background pixels (alpha ~ 0), then
//   F = (I - (1-a)*B) / a
// Division by small alpha amplifies noise, so at low alpha we lean on the colour of
// nearby solid foreground instead. Limits: B is only a local estimate (it cannot know
// what is truly behind the person), so busy backgrounds are corrected only partially.
//
//   rgba  : Uint8ClampedArray, w*h*4
//   alpha : Float32Array(w*h)
// returns Float32Array(w*h*3), foreground colour in [0,1]
export function decontaminate(rgba, alpha, w, h, opts = {}) {
  const R = opts.radius ?? 5;
  const bgT = opts.bgThresh ?? 0.05;
  const fgT = opts.fgThresh ?? 0.95;
  const bandLo = opts.bandLo ?? 0.02;
  const bandHi = opts.bandHi ?? 0.98;
  const minCnt = opts.minCoverage ?? 0.03;
  const n = w * h;

  const wBg = new Float32Array(n);
  const wFg = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    wBg[i] = alpha[i] < bgT ? 1 : 0;
    wFg[i] = alpha[i] > fgT ? 1 : 0;
  }
  const covBg = boxMean(wBg, w, h, R);
  const covFg = boxMean(wFg, w, h, R);

  const I = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    I[0][i] = rgba[p] / 255;
    I[1][i] = rgba[p + 1] / 255;
    I[2][i] = rgba[p + 2] / 255;
  }
  const sBg = [];
  const sFg = [];
  const tmp = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) tmp[i] = wBg[i] * I[c][i];
    sBg.push(boxMean(tmp, w, h, R));
    for (let i = 0; i < n; i++) tmp[i] = wFg[i] * I[c][i];
    sFg.push(boxMean(tmp, w, h, R));
  }

  const F = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    const o = i * 3;
    const inBand = a > bandLo && a < bandHi;
    const hasBg = covBg[i] > minCnt;
    const hasFg = covFg[i] > minCnt;
    if (!inBand || (!hasBg && !hasFg)) {
      F[o] = I[0][i]; F[o + 1] = I[1][i]; F[o + 2] = I[2][i];
      continue;
    }
    // Weight toward nearby solid-foreground colour: high at low alpha.
    const wNear = hasFg ? 0.85 * (1 - smoothstep(0.1, 0.6, a)) : 0;
    for (let c = 0; c < 3; c++) {
      const Ic = I[c][i];
      let Fc = Ic;
      if (hasBg && a >= 0.08) {
        const B = sBg[c][i] / covBg[i];
        Fc = clamp01((Ic - (1 - a) * B) / a);
      }
      if (hasFg) {
        const Fn = sFg[c][i] / covFg[i];
        Fc = !hasBg || a < 0.08 ? Fn : Fc * (1 - wNear) + Fn * wNear;
      }
      F[o + c] = Fc;
    }
  }
  return F;
}

// out = alpha*F + (1-alpha)*newBackground. Returns Uint8ClampedArray RGBA.
export function composite(F, alpha, bgRGBA, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const a = alpha[i];
    out[p] = (a * F[i * 3] * 255 + (1 - a) * bgRGBA[p]) | 0;
    out[p + 1] = (a * F[i * 3 + 1] * 255 + (1 - a) * bgRGBA[p + 1]) | 0;
    out[p + 2] = (a * F[i * 3 + 2] * 255 + (1 - a) * bgRGBA[p + 2]) | 0;
    out[p + 3] = 255;
  }
  return out;
}
