import { boxMean, downsampleArea, resizeBilinear, clamp01 } from './util.js';

// Fast guided filter upsampling (He & Sun, "Fast Guided Filter").
// The low-res alpha is fitted as a local linear function of the full-res luma
// (alpha ~ a*I + b), so edges snap to real image edges at full resolution.
//
//   alphaLow  : model output, (wl x hl)
//   lumaLow   : full-res luma area-downsampled to (wl x hl)
//   lumaFull  : full-res luma, (wf x hf)
//   r         : window radius in LOW-res pixels
//   eps       : regularisation (luma in [0,1]); smaller = sharper, noisier
export function guidedUpsample(alphaLow, lumaLow, lumaFull, wl, hl, wf, hf, opts = {}) {
  const r = opts.r ?? 2;
  const eps = opts.eps ?? 1e-3;
  const n = wl * hl;

  const I = lumaLow;
  const p = alphaLow;
  const II = new Float32Array(n);
  const Ip = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    II[i] = I[i] * I[i];
    Ip[i] = I[i] * p[i];
  }
  const mI = boxMean(I, wl, hl, r);
  const mp = boxMean(p, wl, hl, r);
  const mII = boxMean(II, wl, hl, r);
  const mIp = boxMean(Ip, wl, hl, r);

  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = mII[i] - mI[i] * mI[i];
    const cov = mIp[i] - mI[i] * mp[i];
    const ai = cov / (varI + eps);
    a[i] = ai;
    b[i] = mp[i] - ai * mI[i];
  }
  const ma = boxMean(a, wl, hl, r);
  const mb = boxMean(b, wl, hl, r);

  const aF = resizeBilinear(ma, wl, hl, wf, hf);
  const bF = resizeBilinear(mb, wl, hl, wf, hf);
  const out = new Float32Array(wf * hf);
  for (let i = 0; i < out.length; i++) out[i] = clamp01(aF[i] * lumaFull[i] + bF[i]);
  return out;
}

export function plainUpsample(alphaLow, wl, hl, wf, hf) {
  return resizeBilinear(alphaLow, wl, hl, wf, hf);
}

export { downsampleArea };

// Colour guided filter (He et al.): alpha ~ a . I_rgb + b, with a 3x3 covariance solve per pixel.
// Handles edges where subject and background have similar brightness but different colour,
// which a luma-only guide cannot see.
//   rgbLow / rgbFull: arrays of 3 Float32 planes (low-res and full-res)
export function guidedUpsampleRGB(alphaLow, rgbLow, rgbFull, wl, hl, wf, hf, opts = {}) {
  const r = opts.r ?? 2;
  const eps = opts.eps ?? 1e-3;
  const n = wl * hl;
  const p = alphaLow;
  const mI = rgbLow.map((c) => boxMean(c, wl, hl, r));
  const mp = boxMean(p, wl, hl, r);
  const prod = new Float32Array(n);
  const mIp = [0, 1, 2].map((c) => {
    for (let i = 0; i < n; i++) prod[i] = rgbLow[c][i] * p[i];
    return boxMean(prod, wl, hl, r);
  });
  const mII = {};
  for (const [c, d] of [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]]) {
    for (let i = 0; i < n; i++) prod[i] = rgbLow[c][i] * rgbLow[d][i];
    mII[c + '' + d] = boxMean(prod, wl, hl, r);
  }
  const A = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const Bb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m0 = mI[0][i], m1 = mI[1][i], m2 = mI[2][i];
    const s00 = mII['00'][i] - m0 * m0 + eps, s01 = mII['01'][i] - m0 * m1, s02 = mII['02'][i] - m0 * m2;
    const s11 = mII['11'][i] - m1 * m1 + eps, s12 = mII['12'][i] - m1 * m2, s22 = mII['22'][i] - m2 * m2 + eps;
    const c0 = mIp[0][i] - m0 * mp[i], c1 = mIp[1][i] - m1 * mp[i], c2 = mIp[2][i] - m2 * mp[i];
    const det = s00 * (s11 * s22 - s12 * s12) - s01 * (s01 * s22 - s12 * s02) + s02 * (s01 * s12 - s11 * s02);
    const id = 1 / det;
    const i00 = (s11 * s22 - s12 * s12) * id, i01 = (s02 * s12 - s01 * s22) * id, i02 = (s01 * s12 - s02 * s11) * id;
    const i11 = (s00 * s22 - s02 * s02) * id, i12 = (s01 * s02 - s00 * s12) * id, i22 = (s00 * s11 - s01 * s01) * id;
    const a0 = i00 * c0 + i01 * c1 + i02 * c2;
    const a1 = i01 * c0 + i11 * c1 + i12 * c2;
    const a2 = i02 * c0 + i12 * c1 + i22 * c2;
    A[0][i] = a0; A[1][i] = a1; A[2][i] = a2;
    Bb[i] = mp[i] - a0 * m0 - a1 * m1 - a2 * m2;
  }
  const mA = A.map((c) => boxMean(c, wl, hl, r));
  const mB = boxMean(Bb, wl, hl, r);
  const aF = mA.map((c) => resizeBilinear(c, wl, hl, wf, hf));
  const bF = resizeBilinear(mB, wl, hl, wf, hf);
  const out = new Float32Array(wf * hf);
  for (let i = 0; i < out.length; i++) {
    out[i] = clamp01(aF[0][i] * rgbFull[0][i] + aF[1][i] * rgbFull[1][i] + aF[2][i] * rgbFull[2][i] + bF[i]);
  }
  return out;
}
