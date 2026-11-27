/**
 * EdgeTAM / SAM-2 "gate" logic, pure functions (no DOM, no ort import) so it runs in browsers and in node tests.
 *
 * What the gate does: a base matte (MODNet etc.) may contain false blobs (a second person, a chair, a light). EdgeTAM is
 * prompted with the box + centre of the base matte and returns a clean object mask. The base ALPHA is then multiplied by a
 * slightly grown, feathered copy of that mask, so soft hair edges from the base model are kept and stray blobs are removed.
 *
 * Verified tensor interface (onnx-community EdgeTAM / SAM2.1 exports, checked with onnxruntime):
 *   encoder  in : pixel_values [1,3,1024,1024] f32 (ImageNet mean/std)
 *            out: [1,32,256,256] [1,64,128,128] [1,256,64,64]  (fed to the decoder as image_embeddings.0/.1/.2)
 *   decoder  in : input_points [1,1,N,2] f32 (pixels in 1024 space), input_labels [1,1,N] i64, input_boxes [1,B,4] f32 (B may be 0),
 *                 image_embeddings.0/1/2
 *            out: iou_scores [1,1,3], pred_masks [1,1,3,256,256] logits, object_score_logits [1,1,1]
 */
(function (root) {
  'use strict';
  const SIZE = 1024, MASK = 256;
  const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

  /** RGBA bytes of a SIZExSIZE frame -> Float32 CHW [1,3,1024,1024], ImageNet-normalised. */
  function toPixelValues(rgba, size, outBuf) {
    const s = size || SIZE, n = s * s, out = outBuf && outBuf.length === 3 * n ? outBuf : new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      out[i] = (rgba[j] / 255 - MEAN[0]) / STD[0];
      out[n + i] = (rgba[j + 1] / 255 - MEAN[1]) / STD[1];
      out[2 * n + i] = (rgba[j + 2] / 255 - MEAN[2]) / STD[2];
    }
    return out;
  }

  /** Bounding box, centroid and area of the LARGEST connected blob (4-neighbour) with alpha >= thr, so a stray second blob
   *  in the base matte does not stretch the prompt box. Returns null when empty or smaller than minFrac of the frame. */
  function bboxFromAlpha(alpha, w, h, thr, minFrac) {
    const t = thr == null ? 128 : thr, n = w * h, seen = new Uint8Array(n), stack = new Int32Array(n);
    let best = null;
    for (let s0 = 0; s0 < n; s0++) {
      if (seen[s0] || alpha[s0] < t) continue;
      let sp = 0, cnt = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      stack[sp++] = s0; seen[s0] = 1;
      while (sp) {
        const p = stack[--sp], x = p % w, y = (p / w) | 0;
        cnt++; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && !seen[p - 1] && alpha[p - 1] >= t) { seen[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < w - 1 && !seen[p + 1] && alpha[p + 1] >= t) { seen[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0 && !seen[p - w] && alpha[p - w] >= t) { seen[p - w] = 1; stack[sp++] = p - w; }
        if (y < h - 1 && !seen[p + w] && alpha[p + w] >= t) { seen[p + w] = 1; stack[sp++] = p + w; }
      }
      if (!best || cnt > best.area) best = { x0, y0, x1: x1 + 1, y1: y1 + 1, cx: sx / cnt, cy: sy / cnt, area: cnt, frac: cnt / n };
    }
    return best && best.frac >= (minFrac == null ? 0.01 : minFrac) ? best : null;
  }

  /** Decoder prompt tensors (plain arrays) from a base-matte bbox: one box + one positive point at the centroid.
   *  The centroid is moved to the nearest foreground pixel in its row when it falls on a hole (e.g. between arm and body). */
  function promptFromBox(bb, w, h, alpha) {
    let cx = Math.round(bb.cx), cy = Math.round(bb.cy);
    if (alpha && alpha[cy * w + cx] < 128) {
      let best = -1, bd = 1e9;
      for (let x = 0; x < w; x++) if (alpha[cy * w + x] >= 128) { const d = Math.abs(x - cx); if (d < bd) { bd = d; best = x; } }
      if (best >= 0) cx = best;
    }
    const sx = SIZE / w, sy = SIZE / h;
    return {
      points: new Float32Array([(cx + 0.5) * sx, (cy + 0.5) * sy]),
      labels: new BigInt64Array([1n]),
      boxes: new Float32Array([bb.x0 * sx, bb.y0 * sy, bb.x1 * sx, bb.y1 * sy])
    };
  }

  /** Index of the best of the 3 candidate masks by predicted IoU. */
  function pickBest(iou) { let k = 0; for (let i = 1; i < iou.length; i++) if (iou[i] > iou[k]) k = i; return k; }

  /** Logits slice [256*256] -> Uint8 0/255. */
  function gateFromLogits(logits, thr) {
    const t = thr || 0, out = new Uint8Array(logits.length);
    for (let i = 0; i < logits.length; i++) out[i] = logits[i] > t ? 255 : 0;
    return out;
  }

  /** Separable box max (dilate) then two box-blur passes (feather). Radius in gate pixels. */
  function softGate(gate, w, h, dilate, feather) {
    let cur = gate;
    const pass = (src, r, mode) => {
      const tmp = new Uint8Array(src.length), dst = new Uint8Array(src.length);
      const op = (get, set, len, lines, stride, step) => {
        for (let l = 0; l < lines; l++) {
          for (let i = 0; i < len; i++) {
            let acc = mode === 'max' ? 0 : 0, c = 0;
            for (let k = -r; k <= r; k++) {
              const q = i + k; if (q < 0 || q >= len) continue;
              const v = get(l, q);
              if (mode === 'max') { if (v > acc) acc = v; } else { acc += v; c++; }
            }
            set(l, i, mode === 'max' ? acc : (acc / c + 0.5) | 0);
          }
        }
      };
      op((l, q) => src[l * w + q], (l, i, v) => { tmp[l * w + i] = v; }, w, h);
      op((l, q) => tmp[q * w + l], (l, i, v) => { dst[i * w + l] = v; }, h, w);
      return dst;
    };
    if (dilate > 0) cur = pass(cur, dilate, 'max');
    for (let i = 0; i < (feather > 0 ? 2 : 0); i++) cur = pass(cur, feather, 'avg');
    return cur;
  }

  /** Keep whole connected blobs of the base matte (at gate size) that EdgeTAM agrees with; drop the rest. Never cuts holes into
   *  a kept blob. A blob is kept when at least minOverlap of its pixels fall inside the EdgeTAM mask. Returns Uint8 0/255. */
  function componentGate(base, gate, w, h, thr, minOverlap) {
    const t = thr == null ? 128 : thr, mo = minOverlap == null ? 0.3 : minOverlap, n = w * h;
    const seen = new Uint8Array(n), stack = new Int32Array(n), out = new Uint8Array(n), members = new Int32Array(n);
    for (let s0 = 0; s0 < n; s0++) {
      if (seen[s0] || base[s0] < t) continue;
      let sp = 0, cnt = 0, inside = 0;
      stack[sp++] = s0; seen[s0] = 1;
      while (sp) {
        const p = stack[--sp], x = p % w, y = (p / w) | 0;
        members[cnt++] = p; if (gate[p] >= 128) inside++;
        if (x > 0 && !seen[p - 1] && base[p - 1] >= t) { seen[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < w - 1 && !seen[p + 1] && base[p + 1] >= t) { seen[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0 && !seen[p - w] && base[p - w] >= t) { seen[p - w] = 1; stack[sp++] = p - w; }
        if (y < h - 1 && !seen[p + w] && base[p + w] >= t) { seen[p + w] = 1; stack[sp++] = p + w; }
      }
      if (inside / cnt >= mo) for (let i = 0; i < cnt; i++) out[members[i]] = 255;
    }
    return out;
  }

  /** base alpha (any size) is resampled nearest to the gate size by the caller; here both are the same size. */
  function applyGate(alpha, gate) { const out = new Uint8Array(alpha.length); for (let i = 0; i < out.length; i++) out[i] = (alpha[i] * gate[i] / 255 + 0.5) | 0; return out; }

  /** Refuse a gate that would delete most of the base matte or that EdgeTAM says holds no object. */
  function gateIsSafe(baseArea, keptArea, objectScore) {
    if (objectScore != null && objectScore < 0) return false;
    return baseArea > 0 && keptArea / baseArea >= 0.5;
  }

  /**
   * Full refresh with an injected onnxruntime namespace (`ort`: Tensor class) and two sessions.
   * rgba1024: Uint8ClampedArray of the frame drawn to 1024x1024; base: Uint8Array alpha (bw x bh).
   * Returns { gate: Uint8Array 256x256 (0/255), iou, obj, bbox } or null when there is nothing to track.
   */
  async function refreshGate(ort, enc, dec, rgba1024, base, bw, bh) {
    const bb = bboxFromAlpha(base, bw, bh, 128, 0.01);
    if (!bb) return null;
    const pr = promptFromBox(bb, bw, bh, base);
    // ONNX Runtime Web tensors own WASM/WebGPU allocations. Dispose every
    // input and output after the decoder result has been copied into plain JS
    // values; otherwise each periodic tracker refresh leaks native memory.
    const owned = new Set();
    const tensor = (type, data, dims) => {
      const value = new ort.Tensor(type, data, dims);
      if (value && typeof value.dispose === 'function') owned.add(value);
      return value;
    };
    const collect = (outputs) => {
      if (outputs && typeof outputs === 'object') {
        Object.keys(outputs).forEach((key) => {
          const value = outputs[key];
          if (value && typeof value.dispose === 'function') owned.add(value);
        });
      }
    };
    try {
      const image = tensor('float32', toPixelValues(rgba1024), [1, 3, SIZE, SIZE]);
      const e = await enc.run({ pixel_values: image });
      collect(e);
      const names = Object.keys(e);
      if (names.length < 3) throw new Error('EdgeTAM encoder returned fewer than three embedding tensors');
      const o = await dec.run({
        input_points: tensor('float32', pr.points, [1, 1, 1, 2]),
        input_labels: tensor('int64', pr.labels, [1, 1, 1]),
        input_boxes: tensor('float32', pr.boxes, [1, 1, 4]),
        'image_embeddings.0': e[names[0]], 'image_embeddings.1': e[names[1]], 'image_embeddings.2': e[names[2]]
      });
      collect(o);
      const on = Object.keys(o);
      if (on.length < 2 || !o[on[0]].data || !o[on[1]].data) {
        throw new Error('EdgeTAM decoder returned an invalid output tensor set');
      }
      const iou = Array.from(o[on[0]].data), k = pickBest(iou);
      const masks = o[on[1]].data;
      if (masks.length < (k + 1) * MASK * MASK) throw new Error('EdgeTAM decoder mask tensor has an invalid shape');
      const gate = gateFromLogits(masks.subarray(k * MASK * MASK, (k + 1) * MASK * MASK));
      return { gate, iou: iou[k], obj: o[on[2]] ? o[on[2]].data[0] : null, bbox: bb };
    } finally {
      owned.forEach((value) => { try { value.dispose(); } catch (e) { /* release remaining tensors */ } });
    }
  }

  const api = { SIZE, MASK, toPixelValues, bboxFromAlpha, promptFromBox, pickBest, gateFromLogits, softGate, componentGate, applyGate, gateIsSafe, refreshGate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {};
  root.VS.EdgeTAMCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
