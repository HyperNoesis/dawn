/**
 * MaskMotion v1: confidence-gated optical-flow propagation for asynchronously refreshed portrait mattes.
 * It aligns a reused soft alpha matte with the newest camera frame between model inferences.
 * It refuses to warp across scene cuts, long gaps, stale masks, or low-confidence motion.
 * A new model result always reseeds it. Kill switch in the app: localStorage vs_mask_motion = "0".
 */
(function (root) {
  'use strict';
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const DEFAULTS = {
    gridWidth: 64, gridHeight: 36, blockSize: 8, searchRadius: 2,
    minTextureStd: 3.5, maxSad: 38, minBlockConfidence: 0.12,
    neighbourRadius: 2, minCoverage: 0.08, minMeanConfidence: 0.10,
    sceneCutMean: 46, maxFrameGapMs: 1200, maxMaskAgeMs: 1500
  };

  function meanAbsDiff(a, b) {
    if (!a || !b || a.length !== b.length || !a.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  }

  function blockTexture(src, width, height, x0, y0, bw, bh) {
    let sum = 0, sumSq = 0, n = 0;
    for (let y = y0; y < Math.min(height, y0 + bh); y++) {
      for (let x = x0; x < Math.min(width, x0 + bw); x++) {
        const v = src[y * width + x]; sum += v; sumSq += v * v; n++;
      }
    }
    if (!n) return 0;
    return Math.sqrt(Math.max(0, sumSq / n - (sum / n) * (sum / n)));
  }

  // Backward flow: current(x,y) samples previous(x+dx,y+dy).
  function estimateFlow(previous, current, width, height, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    if (!previous || !current || previous.length !== width * height || current.length !== width * height) {
      throw new Error('MaskMotion flow inputs do not match analysis dimensions');
    }
    const block = o.blockSize, cols = Math.ceil(width / block), rows = Math.ceil(height / block);
    const count = cols * rows, dx = new Float32Array(count), dy = new Float32Array(count);
    const confidence = new Float32Array(count), residual = new Float32Array(count);
    const radius = o.searchRadius;

    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < cols; bx++) {
        const x0 = bx * block, y0 = by * block;
        const x1 = Math.min(width, x0 + block), y1 = Math.min(height, y0 + block);
        const texture = blockTexture(previous, width, height, x0, y0, x1 - x0, y1 - y0);
        let best = Infinity, second = Infinity, bestX = 0, bestY = 0, bestN = 0;

        for (let oy = -radius; oy <= radius; oy++) {
          for (let ox = -radius; ox <= radius; ox++) {
            let sad = 0, n = 0;
            for (let y = y0; y < y1; y++) {
              const py = y + oy;
              if (py < 0 || py >= height) continue;
              for (let x = x0; x < x1; x++) {
                const px = x + ox;
                if (px < 0 || px >= width) continue;
                sad += Math.abs(current[y * width + x] - previous[py * width + px]); n++;
              }
            }
            if (!n) continue;
            const avg = sad / n;
            if (avg < best) { second = best; best = avg; bestX = ox; bestY = oy; bestN = n; }
            else if (avg < second) second = avg;
          }
        }

        const index = by * cols + bx;
        residual[index] = Number.isFinite(best) ? best : 255;
        if (!bestN || texture < o.minTextureStd || best > o.maxSad) continue;
        const textureScore = clamp(texture / 18, 0, 1);
        const residualScore = clamp(1 - best / o.maxSad, 0, 1);
        const separation = Number.isFinite(second) ? clamp((second - best) / 18, 0, 1) : 0;
        const uniqueness = (bestX === 0 && bestY === 0) ? 0.45 + 0.55 * separation : separation;
        const score = textureScore * residualScore * uniqueness;
        if (score >= o.minBlockConfidence) {
          dx[index] = bestX; dy[index] = bestY; confidence[index] = score;
        }
      }
    }

    const rawConfidence = Float32Array.from(confidence);
    let reliableCount = 0;
    for (const value of rawConfidence) if (value >= o.minBlockConfidence) reliableCount++;

    // Fill unreliable blocks only from nearby reliable motion; do not extrapolate globally.
    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < cols; bx++) {
        const index = by * cols + bx;
        if (confidence[index] >= o.minBlockConfidence) continue;
        let sx = 0, sy = 0, sw = 0, sc = 0;
        for (let oy = -o.neighbourRadius; oy <= o.neighbourRadius; oy++) {
          for (let ox = -o.neighbourRadius; ox <= o.neighbourRadius; ox++) {
            if (!ox && !oy) continue;
            const nx = bx + ox, ny = by + oy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            const ni = ny * cols + nx, c = rawConfidence[ni];
            if (c < o.minBlockConfidence) continue;
            const weight = c / (1 + ox * ox + oy * oy);
            sx += dx[ni] * weight; sy += dy[ni] * weight; sw += weight; sc += c;
          }
        }
        if (sw > 0) {
          dx[index] = sx / sw; dy[index] = sy / sw;
          confidence[index] = Math.min(0.45, (sc / Math.max(1, sw)) * 0.45);
        }
      }
    }

    let confSum = 0, motionX = 0, motionY = 0, used = 0;
    for (let i = 0; i < count; i++) {
      confSum += confidence[i];
      if (confidence[i] >= o.minBlockConfidence) {
        motionX += dx[i]; motionY += dy[i]; used++;
      }
    }
    return {
      dx, dy, confidence, residual, cols, rows, blockSize: block,
      coverage: reliableCount / count, meanConfidence: confSum / count,
      meanDx: used ? motionX / used : 0, meanDy: used ? motionY / used : 0
    };
  }

  function sampleBilinear(alpha, width, height, x, y) {
    x = clamp(x, 0, width - 1); y = clamp(y, 0, height - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const a = alpha[y0 * width + x0], b = alpha[y0 * width + x1];
    const c = alpha[y1 * width + x0], d = alpha[y1 * width + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  function warpAlpha(alpha, width, height, flow, gridWidth, gridHeight) {
    if (!alpha || alpha.length !== width * height) throw new Error('MaskMotion alpha size is invalid');
    const output = new Uint8Array(alpha.length), block = flow.blockSize;
    const sx = width / gridWidth, sy = height / gridHeight;
    for (let y = 0; y < height; y++) {
      const gy = Math.min(flow.rows - 1, Math.floor((y / sy) / block));
      for (let x = 0; x < width; x++) {
        const gx = Math.min(flow.cols - 1, Math.floor((x / sx) / block));
        const i = gy * flow.cols + gx, use = flow.confidence[i] >= 0.06;
        const px = use ? x + flow.dx[i] * sx : x;
        const py = use ? y + flow.dy[i] * sy : y;
        output[y * width + x] = Math.round(sampleBilinear(alpha, width, height, px, py));
      }
    }
    return output;
  }

  class MaskMotion {
    constructor(options) {
      this.options = Object.assign({}, DEFAULTS, options || {});
      this.alpha = null; this.previousLuma = null;
      this.width = 0; this.height = 0; this.seededAt = 0; this.previousAt = 0;
      this.canvas = null; this.ctx = null; this.analysisCanvas = null; this.analysisCtx = null; this.suspended = false;
      this.metrics = { status: 'idle', ageMs: 0, meanConfidence: 0, coverage: 0, meanMotionPx: 0, warped: false };
    }

    _ensureAnalysisCanvas() {
      const o = this.options;
      if (!this.analysisCanvas) {
        this.analysisCanvas = document.createElement('canvas');
        this.analysisCanvas.width = o.gridWidth; this.analysisCanvas.height = o.gridHeight;
        this.analysisCtx = this.analysisCanvas.getContext('2d', { willReadFrequently: true });
      }
      if (!this.analysisCtx) throw new Error('MaskMotion could not create its analysis canvas');
    }

    _readLuma(source) {
      const o = this.options; this._ensureAnalysisCanvas();
      this.analysisCtx.drawImage(source, 0, 0, o.gridWidth, o.gridHeight);
      const rgba = this.analysisCtx.getImageData(0, 0, o.gridWidth, o.gridHeight).data;
      const luma = new Uint8Array(o.gridWidth * o.gridHeight);
      for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
        luma[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
      }
      return luma;
    }

    _ensureMaskCanvas(width, height) {
      if (!this.canvas) this.canvas = document.createElement('canvas');
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width; this.canvas.height = height;
      }
      if (!this.ctx || this._ctxWidth !== width || this._ctxHeight !== height) {
        this.ctx = this.canvas.getContext('2d');
        this._ctxWidth = width; this._ctxHeight = height;
      }
      if (!this.ctx) throw new Error('MaskMotion could not create its mask canvas');
    }

    _writeCanvas() {
      this._ensureMaskCanvas(this.width, this.height);
      const image = this.ctx.createImageData(this.width, this.height), d = image.data;
      for (let i = 0, p = 0; i < this.alpha.length; i++, p += 4) {
        d[p] = d[p + 1] = d[p + 2] = 255; d[p + 3] = this.alpha[i];
      }
      this.ctx.putImageData(image, 0, 0);
      return this.canvas;
    }

    seed(mask, sourceFrame, timestamp) {
      if (!mask || !(mask.width > 0 && mask.height > 0)) throw new Error('MaskMotion requires a valid mask image');
      this.width = mask.width; this.height = mask.height;
      const readCanvas = document.createElement('canvas');
      readCanvas.width = this.width; readCanvas.height = this.height;
      const readCtx = readCanvas.getContext('2d', { willReadFrequently: true });
      if (!readCtx) throw new Error('MaskMotion could not read the seed mask');
      readCtx.drawImage(mask, 0, 0, this.width, this.height);
      const data = readCtx.getImageData(0, 0, this.width, this.height).data;
      this.alpha = new Uint8Array(this.width * this.height);
      for (let i = 0, p = 3; i < this.alpha.length; i++, p += 4) this.alpha[i] = data[p];
      this.previousLuma = sourceFrame ? this._readLuma(sourceFrame) : null;
      this.suspended = false;
      // The frame timestamp belongs to the model input, but the mask only
      // becomes available after inference completes. Measure matte age from
      // delivery time, while retaining the source timestamp for first-frame
      // motion catch-up.
      this.previousAt = Number.isFinite(timestamp) ? timestamp : performance.now();
      this.seededAt = performance.now();
      this.metrics = { status: this.previousLuma ? 'seeded' : 'unpaired-seed', ageMs: 0, meanConfidence: 0, coverage: 0, meanMotionPx: 0, warped: false };
      return this._writeCanvas();
    }

    advance(sourceFrame, timestamp) {
      if (!this.alpha || !this.previousLuma || !sourceFrame) return null;
      const started = performance.now();
      const now = Number.isFinite(timestamp) ? timestamp : performance.now();
      const age = Math.max(0, now - this.seededAt), gap = now - this.previousAt;
      if (this.suspended) {
        this.metrics = { status: 'awaiting-new-mask', ageMs: Math.round(age), meanConfidence: 0, coverage: 0, meanMotionPx: 0, warped: false, durationMs: +(performance.now() - started).toFixed(2) };
        return this._writeCanvas();
      }
      const luma = this._readLuma(sourceFrame);
      const diff = meanAbsDiff(this.previousLuma, luma);
      let status = 'static', flow = null, warped = false;

      if (age > this.options.maxMaskAgeMs) { status = 'stale-mask'; this.suspended = true; }
      else if (gap < 0 || gap > this.options.maxFrameGapMs) { status = 'frame-gap'; this.suspended = true; }
      else if (diff > this.options.sceneCutMean) { status = 'scene-cut'; this.suspended = true; }
      else {
        flow = estimateFlow(this.previousLuma, luma, this.options.gridWidth, this.options.gridHeight, this.options);
        if (flow.coverage < this.options.minCoverage || flow.meanConfidence < this.options.minMeanConfidence) {
          status = 'low-confidence'; this.suspended = true;
        } else {
          this.alpha = warpAlpha(this.alpha, this.width, this.height, flow, this.options.gridWidth, this.options.gridHeight);
          status = 'warped'; warped = true;
        }
      }

      if (!this.suspended) { this.previousLuma = luma; this.previousAt = now; }
      this.metrics = {
        status, ageMs: Math.round(age),
        meanConfidence: flow ? +flow.meanConfidence.toFixed(3) : 0,
        coverage: flow ? +flow.coverage.toFixed(3) : 0,
        meanMotionPx: flow ? +Math.hypot(flow.meanDx, flow.meanDy).toFixed(2) : 0,
        warped, durationMs: +(performance.now() - started).toFixed(2)
      };
      return this._writeCanvas();
    }

    getMetrics() { return Object.assign({}, this.metrics); }

    reset() {
      this.alpha = null; this.previousLuma = null; this.suspended = false;
      this.width = this.height = this.seededAt = this.previousAt = 0;
      this.metrics = { status: 'reset', ageMs: 0, meanConfidence: 0, coverage: 0, meanMotionPx: 0, warped: false };
    }

    dispose() {
      this.reset(); this.canvas = this.analysisCanvas = null; this.ctx = this.analysisCtx = null;
    }
  }

  const api = { DEFAULTS, meanAbsDiff, estimateFlow, warpAlpha, MaskMotion };
  root.VS = root.VS || {}; root.VS.MaskMotion = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
