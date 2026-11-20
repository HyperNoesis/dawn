// Synthetic evidence for each stage. NOT real-camera proof: it checks the maths and
// the failure modes (flicker, lag, ghosting, halos) under controlled conditions.
import assert from 'node:assert/strict';
import { SegmentationRefiner } from '../src/pipeline.js';
import { composite } from '../src/edgecolor.js';
import {
  boxMean, downsampleArea, resizeBilinear, clamp01, smoothstep, mulberry32, gauss,
} from '../src/util.js';

const W = 640, H = 360, wl = 160, hl = 90;
const N = W * H;

// ---------- synthetic scene ----------
function gtAlpha(cx, cy, present = true) {
  const a = new Float32Array(N);
  if (!present) return a;
  const rx = 0.16 * W, ry = 0.38 * H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ex = (x - cx) / rx, ey = (y - cy) / ry;
      const rho = Math.hypot(ex, ey);
      const th = Math.atan2(ey, ex);
      // hair-like fringe: high-frequency radius modulation
      const edgeR = 1 + 0.06 * Math.sin(17 * th) + 0.04 * Math.sin(37 * th + 1.3) + 0.03 * Math.sin(61 * th + 0.4);
      const s = (rho - edgeR) * rx; // approx signed distance in px
      const top = Math.max(0, -(y - cy) / ry);
      const soft = 1.2 + 3 * top * top; // softer at the top (hair)
      a[y * W + x] = clamp01(0.5 - s / (2 * soft));
    }
  }
  return a;
}
const fgColor = (x, y) => [0.75 + 0.1 * Math.sin(x / 9), 0.35 + 0.1 * Math.sin(y / 7), 0.30];
function bgColor(x, y, scene, uniform) {
  if (uniform) return [0.05, 0.85, 0.1];
  return scene === 0
    ? [0.15 + 0.3 * x / W, 0.55 + 0.1 * Math.sin(y / 20), 0.25 + 0.2 * y / H]
    : [0.8 - 0.3 * x / W, 0.3, 0.6 + 0.2 * Math.sin(x / 15)];
}
function renderFrame(gt, scene, rng, uniform = false, noise = 0.01) {
  const d = new Uint8ClampedArray(N * 4);
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      const F = fgColor(x, y), B = bgColor(x, y, scene, uniform), a = gt[i];
      for (let c = 0; c < 3; c++) {
        d[i * 4 + c] = clamp01(a * F[c] + (1 - a) * B[c] + noise * gauss(rng)) * 255;
      }
      d[i * 4 + 3] = 255;
    }
  }
  return { data: d, width: W, height: H };
}
// Fake "matting model": low-res, soft, jittery, noisy (what real lightweight models do).
function modelAlpha(cx, cy, rng, present = true) {
  const jx = (rng() - 0.5) * 1.2 * (W / wl), jy = (rng() - 0.5) * 1.2 * (H / hl);
  const g = gtAlpha(cx + jx, cy + jy, present);
  let low = downsampleArea(g, W, H, wl, hl);
  low = boxMean(low, wl, hl, 1);
  for (let i = 0; i < low.length; i++) {
    const edge = low[i] > 0.01 && low[i] < 0.99;
    low[i] = present ? clamp01(low[i] + (edge ? 0.06 : 0.01) * gauss(rng)) : clamp01(0.003 * Math.abs(gauss(rng)));
  }
  return { data: low, width: wl, height: hl };
}

// ---------- metrics ----------
function bandMask(gt) {
  const m = new Float32Array(N);
  for (let i = 0; i < N; i++) m[i] = gt[i] > 0.001 && gt[i] < 0.999 ? 1 : 0;
  const d = boxMean(m, W, H, 3);
  return d.map((v) => (v > 0 ? 1 : 0));
}
function mae(a, gt, band) {
  let s = 0, c = 0;
  for (let i = 0; i < N; i++) if (band[i]) { s += Math.abs(a[i] - gt[i]); c++; }
  return c ? s / c : 0;
}
const avg = (xs) => xs.reduce((p, q) => p + q, 0) / xs.length;
const f = (v, d = 4) => v.toFixed(d);

function runSeq(frames, stages, tOpts = {}, extra = {}) {
  const r = new SegmentationRefiner({ stages: { temporal: false, guided: false, edgeColor: false, ...stages }, temporal: tOpts, ...extra });
  return frames.map((fr, k) => {
    const out = r.process(fr.frame, fr.alpha, k * 33);
    return { alpha: new Float32Array(out.alpha), reset: out.diag.reset, ms: out.diag.ms };
  });
}
function emaBaseline(frames, w) {
  let st = null;
  return frames.map((fr) => {
    const a = fr.alpha.data;
    if (!st) st = new Float32Array(a); else for (let i = 0; i < a.length; i++) st[i] = st[i] * (1 - w) + a[i] * w;
    return { alpha: resizeBilinear(st, wl, hl, W, H) };
  });
}

const results = {};
let rng = mulberry32(7);

// ---------- 1. STATIC subject: spatial accuracy + flicker ----------
{
  const cx = 320, cy = 180, gt = gtAlpha(cx, cy), band = bandMask(gt);
  const frames = [];
  for (let k = 0; k < 40; k++) frames.push({ frame: renderFrame(gt, 0, rng), alpha: modelAlpha(cx, cy, rng) });
  const variants = {
    raw_bilinear: runSeq(frames, {}),
    guided_luma_only: runSeq(frames, { guided: true }, {}, { guided: { mode: 'luma' } }),
    guided_only: runSeq(frames, { guided: true }),
    temporal_only: runSeq(frames, { temporal: true }),
    temporal_plus_guided: runSeq(frames, { temporal: true, guided: true }),
    ema_0p5: emaBaseline(frames, 0.5),
  };
  const flick = (seq) => {
    const idx = []; for (let i = 0; i < N; i++) if (band[i]) idx.push(i);
    let tot = 0;
    for (const i of idx) {
      let m = 0, v = 0; const vals = seq.slice(10).map((s) => s.alpha[i]);
      for (const x of vals) m += x; m /= vals.length;
      for (const x of vals) v += (x - m) ** 2;
      tot += Math.sqrt(v / vals.length);
    }
    return tot / idx.length;
  };
  results.static = {};
  for (const [k, seq] of Object.entries(variants)) {
    results.static[k] = { mae: avg(seq.slice(10).map((s) => mae(s.alpha, gt, band))), flicker: flick(seq) };
  }
}

// ---------- 2. MOVING subject: lag / trails ----------
{
  const frames = [], gts = [];
  for (let k = 0; k < 30; k++) {
    const cx = 200 + 8 * k, cy = 180;
    const gt = gtAlpha(cx, cy); gts.push(gt);
    frames.push({ frame: renderFrame(gt, 0, rng), alpha: modelAlpha(cx, cy, rng) });
  }
  const bands = gts.map(bandMask);
  const variants = {
    raw_bilinear: runSeq(frames, {}),
    temporal_gated: runSeq(frames, { temporal: true }),
    ema_0p5: emaBaseline(frames, 0.5),
    ema_0p2_heavy: emaBaseline(frames, 0.2),
  };
  results.motion = {};
  for (const [k, seq] of Object.entries(variants)) {
    results.motion[k] = { mae: avg(seq.slice(3).map((s, i) => mae(s.alpha, gts[i + 3], bands[i + 3]))) };
  }
}

// ---------- 3. SCENE CUT: ghost + reset ----------
{
  const gtA = gtAlpha(220, 180), gtB = gtAlpha(430, 190);
  const frames = [];
  for (let k = 0; k < 10; k++) frames.push({ frame: renderFrame(gtA, 0, rng), alpha: modelAlpha(220, 180, rng) });
  for (let k = 0; k < 6; k++) frames.push({ frame: renderFrame(gtB, 1, rng), alpha: modelAlpha(430, 190, rng) });
  const ours = runSeq(frames, { temporal: true });
  const ema = emaBaseline(frames, 0.2);
  const bandB = bandMask(gtB);
  results.cut = {
    reset_at_frame10: ours[10].reset,
    ours_mae_frame10: mae(ours[10].alpha, gtB, bandB),
    ema_heavy_mae_frame10: mae(ema[10].alpha, gtB, bandB),
  };
}

// ---------- 4. RE-ENTRY: leave and come back ----------
{
  const gt = gtAlpha(320, 180), none = gtAlpha(0, 0, false);
  const frames = [];
  for (let k = 0; k < 8; k++) frames.push({ frame: renderFrame(gt, 0, rng), alpha: modelAlpha(320, 180, rng) });
  for (let k = 0; k < 8; k++) frames.push({ frame: renderFrame(none, 0, rng), alpha: modelAlpha(0, 0, rng, false) });
  const reIdx = frames.length;
  for (let k = 0; k < 4; k++) frames.push({ frame: renderFrame(gt, 0, rng), alpha: modelAlpha(320, 180, rng) });
  const ours = runSeq(frames, { temporal: true });
  const band = bandMask(gt);
  results.reentry = { reset_at_return: ours[reIdx].reset, mae_first_frame_back: mae(ours[reIdx].alpha, gt, band) };
}

// ---------- 5. HALO / colour decontamination on a green-screen-like background ----------
{
  const gt = gtAlpha(320, 180), band = bandMask(gt);
  const frame = renderFrame(gt, 0, rng, true, 0.004);
  const newBg = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) { newBg[i * 4] = 40; newBg[i * 4 + 1] = 60; newBg[i * 4 + 2] = 220; newBg[i * 4 + 3] = 255; }
  // reference composite with TRUE foreground colour
  const Ftrue = new Float32Array(N * 3);
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) { const c = fgColor(x, y); Ftrue.set(c, i * 3); }
  const ref = composite(Ftrue, gt, newBg, W, H);
  // naive: use the camera pixel as foreground colour
  const Fnaive = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) Fnaive[i * 3 + c] = frame.data[i * 4 + c] / 255;
  const naive = composite(Fnaive, gt, newBg, W, H);
  const r = new SegmentationRefiner({ stages: { temporal: false, guided: false, edgeColor: true } });
  const out = r.process(frame, { data: gt, width: W, height: H }, 0); // alpha given at full res (isolates colour stage)
  const clean = composite(out.fg, gt, newBg, W, H);
  const rmse = (img) => {
    let s = 0, c = 0;
    for (let i = 0; i < N; i++) if (band[i]) for (let k = 0; k < 3; k++) { s += (img[i * 4 + k] - ref[i * 4 + k]) ** 2; c++; }
    return Math.sqrt(s / c);
  };
  results.halo = { naive_edge_rmse_0to255: rmse(naive), decontaminated_edge_rmse_0to255: rmse(clean) };
}

// ---------- 6. COST (CPU reference, 640x360 frame, 160x90 model) ----------
{
  const gt = gtAlpha(320, 180);
  const frame = renderFrame(gt, 0, rng);
  const r = new SegmentationRefiner();
  const ms = [];
  for (let k = 0; k < 12; k++) ms.push(r.process(frame, modelAlpha(320, 180, rng), k * 33).diag.ms);
  const m = ms.slice(2);
  results.cost_ms_cpu_reference = {
    temporal: avg(m.map((x) => x.temporal)), guided: avg(m.map((x) => x.guided)),
    edgeColor: avg(m.map((x) => x.edgeColor)), total: avg(m.map((x) => x.total)),
  };
}

console.log(JSON.stringify(results, null, 2));

// ---------- acceptance assertions (what each stage must prove) ----------
const S = results.static, M = results.motion;
assert(S.guided_only.mae < S.raw_bilinear.mae * 0.9, 'guided upsample must cut edge error by >=10% vs bilinear');
assert(S.temporal_only.flicker < S.raw_bilinear.flicker * 0.8, 'temporal fusion must cut flicker by >=20%');
assert(S.temporal_plus_guided.mae < S.raw_bilinear.mae, 'combined must not be less accurate than raw');
assert(M.temporal_gated.mae < M.ema_0p2_heavy.mae, 'gated fusion must lag less than heavy EMA');
assert(M.temporal_gated.mae < M.raw_bilinear.mae * 1.15, 'gated fusion must stay within 15% of raw error while moving');
assert.equal(results.cut.reset_at_frame10, 'scene-cut');
assert(results.cut.ours_mae_frame10 < results.cut.ema_heavy_mae_frame10, 'reset must beat ghosting EMA at a cut');
assert.equal(results.reentry.reset_at_return, 're-entry');
assert(results.halo.decontaminated_edge_rmse_0to255 < results.halo.naive_edge_rmse_0to255 * 0.6, 'colour cleanup must cut halo error by >=40%');
console.log('\nALL ACCEPTANCE ASSERTIONS PASSED');
