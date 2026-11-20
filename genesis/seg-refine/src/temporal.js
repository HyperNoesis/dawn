import { boxMean, smoothstep, mean } from './util.js';

// Per-pixel gated blend of the previous fused alpha and the new model alpha.
//
//   weight on NEW alpha = wMin + (1 - wMin) * max(motionGate, bigChangeGate)
//
// - Static pixel, small model wobble  -> weight stays at wMin (strong smoothing, no flicker)
// - Pixel where the image moved       -> weight rises to 1 (no trail)
// - Alpha changes with NO image change are model noise -> smoothed. Only a very large
//   disagreement (d > d0..d1) overrides this (model finally found / lost the person).
//
// Hard resets (state dropped, current alpha taken as-is):
//   init, size change, time gap, scene cut, re-entry after the frame was empty.
export class TemporalFusion {
  constructor(opts = {}) {
    this.o = {
      wMin: 0.35,
      m0: 0.02, m1: 0.12,      // luma change gate (noise floor -> full motion)
      d0: 0.45, d1: 0.8,       // big-disagreement gate (override)
      cutThresh: 0.18,         // mean |dRGB| over frame that counts as a scene cut
      emptyArea: 0.004,        // mean alpha below this = frame has no person
      emptyFrames: 5,          // empty this long, then person appears = re-entry reset
      maxGapMs: 250,           // gap between frames above this = stale state
      ...opts,
    };
    this.reset('init');
  }

  reset(reason) {
    this.state = null;
    this.prevL = null;
    this.prevT = null;
    this.w = 0;
    this.h = 0;
    this.emptyCount = 0;
    this.lastReset = reason;
  }

  // alpha: Float32Array(w*h); rgb: [R,G,B] planes at model resolution. Returns {alpha, reset, meanWeight}.
  // The returned alpha buffer is internal state; copy it if you need to keep it.
  step(alpha, rgb, w, h, tMs) {
    const o = this.o;
    const n = w * h;
    let reason = null;

    if (!this.state || this.w !== w || this.h !== h) {
      reason = this.state ? 'size-change' : 'init';
    } else if (tMs - this.prevT > o.maxGapMs) {
      reason = 'gap';
    } else {
      let d = 0;
      const P = this.prevL;
      for (let i = 0; i < n; i++) {
        d += Math.abs(rgb[0][i] - P[0][i]) + Math.abs(rgb[1][i] - P[1][i]) + Math.abs(rgb[2][i] - P[2][i]);
      }
      if (d / (3 * n) > o.cutThresh) reason = 'scene-cut';
    }

    const area = mean(alpha);
    if (reason === null) {
      if (area < o.emptyArea) {
        this.emptyCount++;
      } else {
        if (this.emptyCount >= o.emptyFrames) reason = 're-entry';
        this.emptyCount = 0;
      }
    } else if (area < o.emptyArea) {
      this.emptyCount = 1;
    } else {
      this.emptyCount = 0;
    }

    if (reason !== null) {
      this.state = new Float32Array(alpha);
      this.prevL = rgb.map((c) => new Float32Array(c));
      this.prevT = tMs;
      this.w = w;
      this.h = h;
      this.lastReset = reason;
      return { alpha: this.state, reset: reason, meanWeight: 1 };
    }

    // Noise-robust motion map: small box blur of |dLuma|.
    const m = new Float32Array(n);
    const P = this.prevL;
    for (let i = 0; i < n; i++) {
      m[i] = (Math.abs(rgb[0][i] - P[0][i]) + Math.abs(rgb[1][i] - P[1][i]) + Math.abs(rgb[2][i] - P[2][i])) / 3;
    }
    const mb = boxMean(m, w, h, 1);

    const s = this.state;
    let wsum = 0;
    for (let i = 0; i < n; i++) {
      const tm = smoothstep(o.m0, o.m1, mb[i]);
      const td = smoothstep(o.d0, o.d1, Math.abs(alpha[i] - s[i]));
      const wc = o.wMin + (1 - o.wMin) * (tm > td ? tm : td);
      s[i] = s[i] * (1 - wc) + alpha[i] * wc;
      wsum += wc;
    }
    for (let c = 0; c < 3; c++) this.prevL[c].set(rgb[c]);
    this.prevT = tMs;
    return { alpha: s, reset: null, meanWeight: wsum / n };
  }
}
