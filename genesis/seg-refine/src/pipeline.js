import { lumaFromRGBA, downsampleArea, splitRGB } from './util.js';
import { TemporalFusion } from './temporal.js';
import { guidedUpsample, guidedUpsampleRGB, plainUpsample } from './guided.js';
import { decontaminate } from './edgecolor.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Segmentation refinement pipeline, model-agnostic.
// Input : camera frame (full or working res) + soft alpha from ANY matting model (lower res).
// Output: full-res stabilised alpha (+ optional decontaminated foreground colour).
//
//   stages: { temporal, guided, edgeColor }  booleans, for ablation tests
//   Order : temporal (cheap, low-res) -> guided upsample -> edge colour
export class SegmentationRefiner {
  constructor(opts = {}) {
    this.stages = { temporal: true, guided: true, edgeColor: true, ...(opts.stages || {}) };
    this.temporal = new TemporalFusion(opts.temporal);
    this.guidedOpts = { r: 2, eps: 1e-3, mode: 'rgb', ...(opts.guided || {}) };
    this.edgeOpts = opts.edgeColor || {};
  }

  // Call on camera restart, tab-hidden resume, or manual toggle.
  reset(reason = 'manual') {
    this.temporal.reset(reason);
  }

  // frame: {data:Uint8ClampedArray RGBA, width, height}
  // alpha: {data:Float32Array [0,1], width, height}   (model output, same aspect as frame)
  process(frame, alpha, tMs) {
    const t0 = now();
    const wf = frame.width, hf = frame.height;
    const wl = alpha.width, hl = alpha.height;
    const diag = { reset: null, ms: {}, meanWeight: null };

    const rgbFull = splitRGB(frame.data, wf, hf);
    const rgbLow = rgbFull.map((c) => downsampleArea(c, wf, hf, wl, hl));
    const t1 = now();

    let a = alpha.data;
    if (this.stages.temporal) {
      const r = this.temporal.step(a, rgbLow, wl, hl, tMs);
      a = r.alpha;
      diag.reset = r.reset;
      diag.meanWeight = r.meanWeight;
    }
    const t2 = now();

    let full;
    if (!this.stages.guided) {
      full = plainUpsample(a, wl, hl, wf, hf);
    } else if (this.guidedOpts.mode === 'luma') {
      const lf = lumaFromRGBA(frame.data, wf, hf);
      full = guidedUpsample(a, downsampleArea(lf, wf, hf, wl, hl), lf, wl, hl, wf, hf, this.guidedOpts);
    } else {
      full = guidedUpsampleRGB(a, rgbLow, rgbFull, wl, hl, wf, hf, this.guidedOpts);
    }
    const t3 = now();

    let fg = null;
    if (this.stages.edgeColor) fg = decontaminate(frame.data, full, wf, hf, this.edgeOpts);
    const t4 = now();

    diag.ms = { prep: t1 - t0, temporal: t2 - t1, guided: t3 - t2, edgeColor: t4 - t3, total: t4 - t0 };
    return { alpha: full, fg, diag };
  }
}

export { TemporalFusion, guidedUpsample, plainUpsample, decontaminate };
export { composite } from './edgecolor.js';
