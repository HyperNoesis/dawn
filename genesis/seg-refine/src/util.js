// Shared helpers. All planes are Float32Array in [0,1], row-major, one channel.

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function smoothstep(e0, e1, x) {
  const t = (x - e0) / (e1 - e0);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

// Mean over a (2r+1)^2 window, window clamped at borders. O(n), independent of r.
export function boxMean(src, w, h, r, dst, tmp) {
  dst = dst || new Float32Array(w * h);
  tmp = tmp || new Float32Array(w * h);
  const pre = new Float64Array(w + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    pre[0] = 0;
    for (let x = 0; x < w; x++) pre[x + 1] = pre[x] + src[o + x];
    for (let x = 0; x < w; x++) {
      const lo = x - r < 0 ? 0 : x - r;
      const hi = x + r >= w ? w - 1 : x + r;
      tmp[o + x] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
    }
  }
  const col = new Float64Array(w);
  let lo = 0;
  let hi = Math.min(r, h - 1);
  for (let y = lo; y <= hi; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) col[x] += tmp[o + x];
  }
  for (let y = 0; y < h; y++) {
    const nlo = Math.max(0, y - r);
    const nhi = Math.min(h - 1, y + r);
    while (hi < nhi) {
      hi++;
      const o = hi * w;
      for (let x = 0; x < w; x++) col[x] += tmp[o + x];
    }
    while (lo < nlo) {
      const o = lo * w;
      for (let x = 0; x < w; x++) col[x] -= tmp[o + x];
      lo++;
    }
    const cnt = nhi - nlo + 1;
    const o = y * w;
    for (let x = 0; x < w; x++) dst[o + x] = col[x] / cnt;
  }
  return dst;
}

// Area-average downsample (anti-aliased) from (wf,hf) to (wl,hl).
export function downsampleArea(src, wf, hf, wl, hl) {
  const dst = new Float32Array(wl * hl);
  const sx = wf / wl;
  const sy = hf / hl;
  for (let y = 0; y < hl; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(hf, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < wl; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(wf, Math.ceil((x + 1) * sx)));
      let s = 0;
      for (let yy = y0; yy < y1; yy++) {
        const o = yy * wf;
        for (let xx = x0; xx < x1; xx++) s += src[o + xx];
      }
      dst[y * wl + x] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  return dst;
}

export function resizeBilinear(src, ws, hs, wd, hd, dst) {
  dst = dst || new Float32Array(wd * hd);
  const sx = ws / wd;
  const sy = hs / hd;
  for (let y = 0; y < hd; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const ya = y0 < 0 ? 0 : y0 >= hs ? hs - 1 : y0;
    const yb = y0 + 1 < 0 ? 0 : y0 + 1 >= hs ? hs - 1 : y0 + 1;
    for (let x = 0; x < wd; x++) {
      const fx = (x + 0.5) * sx - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const xa = x0 < 0 ? 0 : x0 >= ws ? ws - 1 : x0;
      const xb = x0 + 1 < 0 ? 0 : x0 + 1 >= ws ? ws - 1 : x0 + 1;
      const top = src[ya * ws + xa] * (1 - tx) + src[ya * ws + xb] * tx;
      const bot = src[yb * ws + xa] * (1 - tx) + src[yb * ws + xb] * tx;
      dst[y * wd + x] = top * (1 - ty) + bot * ty;
    }
  }
  return dst;
}

export function lumaFromRGBA(rgba, w, h) {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    out[i] = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) / 255;
  }
  return out;
}

export function mean(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

// Deterministic RNG for tests.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rng) {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Split RGBA bytes into three Float32 planes [R,G,B] in [0,1].
export function splitRGB(rgba, w, h) {
  const n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    R[i] = rgba[p] / 255; G[i] = rgba[p + 1] / 255; B[i] = rgba[p + 2] / 255;
  }
  return [R, G, B];
}
