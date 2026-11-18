// MatteRefine: hole preservation + foreground colour estimation, on synthetic data where the true answer is known.
const R = require('../../js/providers/matte-refine.js'); const assert = require('assert');
const W = 80, H = 60;

// --- preserveHoles: a hand-like blob with a finger gap (enclosed hole) and a 2px pinhole
const raw = new Uint8Array(W * H); for (let y = 10; y < 50; y++) for (let x = 20; x < 60; x++) raw[y * W + x] = 255;
for (let y = 20; y < 32; y++) for (let x = 38; x < 42; x++) raw[y * W + x] = 0;          // finger gap: 4x12 = 48 px, enclosed
raw[40 * W + 30] = 0; raw[40 * W + 31] = 0;                                              // pinhole 2 px
const cleaned = new Uint8Array(W * H); for (let y = 10; y < 50; y++) for (let x = 20; x < 60; x++) cleaned[y * W + x] = 255;   // cleanup filled both
let r = R.preserveHoles(raw, cleaned, W, H, { minHole: 12 });
assert.equal(r.holesRestored, 1, 'only the finger gap is restored'); assert.equal(r.alpha[25 * W + 40], 0, 'gap is open again'); assert.equal(r.alpha[40 * W + 30], 255, 'pinhole stays filled (debris)');
assert.equal(raw[25 * W + 40], 0, 'raw untouched'); assert.equal(cleaned[25 * W + 40], 255, 'cleaned input untouched');
// a gap that is open to the outside is background, not a hole: nothing to restore
const notch = Uint8Array.from(raw); for (let y = 10; y < 20; y++) notch[y * W + 40] = 0;   // channel from the top edge into the gap region
r = R.preserveHoles(notch, cleaned, W, H, { minHole: 12 }); assert.equal(r.holesRestored, 0);

// --- estimateForeground: build C = aF + (1-a)B along a soft vertical edge, known F (warm skin) and B (strong green background)
const F = [200, 140, 110], B = [20, 200, 30], rgba = new Uint8ClampedArray(W * H * 4), alpha = new Uint8Array(W * H), trueF = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const a = Math.min(1, Math.max(0, (x - 30) / 20)), i = y * W + x; alpha[i] = Math.round(a * 255);
  for (let c = 0; c < 3; c++) { rgba[i * 4 + c] = a * F[c] + (1 - a) * B[c]; trueF[i * 4 + c] = F[c]; } rgba[i * 4 + 3] = 255; trueF[i * 4 + 3] = 255;
}
const out = R.estimateForeground(rgba, alpha, W, H, { radius: 8 });
const err = (img) => { let s = 0, n = 0; for (let y = 0; y < H; y++) for (let x = 32; x < 48; x++) { const i = (y * W + x) * 4; for (let c = 0; c < 3; c++) { s += Math.abs(img[i + c] - F[c]); n++; } } return s / n; };
const before = err(rgba), after = err(out.rgba);
assert(out.edited > 0, 'edge pixels edited'); assert(after < before * 0.35, 'green spill reduced a lot: ' + before.toFixed(1) + ' -> ' + after.toFixed(1));
for (let i = 0; i < W * H; i++) assert.equal(out.rgba[i * 4 + 3], rgba[i * 4 + 3], 'alpha channel untouched');
// solid interior / pure background pixels are never modified
assert.equal(out.rgba[30 * W * 4 + 70 * 4], rgba[30 * W * 4 + 70 * 4]); assert.equal(out.rgba[30 * W * 4 + 5 * 4], rgba[30 * W * 4 + 5 * 4]);
// no neighbours of a kind (all-soft image): returns input unchanged rather than inventing colours
const soft = new Uint8Array(W * H).fill(128), o2 = R.estimateForeground(rgba, soft, W, H); assert.equal(o2.edited, 0);

// --- compare
const c = R.compare(raw, raw, W, H); assert.equal(c.changedPct, 0); assert.equal(c.fractionalKeptPct, 100);
// --- keepMainSubject: stray blobs removed, real second subject and soft edges kept
{
  const w = 200, h = 150, a = new Uint8Array(w * h);
  const rect = (x0, y0, x1, y1, v) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * w + x] = v; };
  rect(20, 20, 120, 130, 255);                 // main: 11000 px
  rect(118, 60, 122, 70, 120);                 // soft edge strip beside main (hair-like), must survive
  rect(150, 100, 156, 105, 255);               // blob 30 px  (0.3%)  -> remove
  rect(160, 20, 170, 40, 255);                 // blob 200 px (1.8%)  -> remove
  rect(150, 50, 185, 80, 255);                 // second subject 1050 px (9.5%) -> keep
  const r = R.keepMainSubject(a, w, h);
  assert.equal(r.removed, 2, 'two stray blobs removed'); assert.equal(r.kept, 2, 'main + real second subject kept');
  assert.equal(r.alpha[102 * w + 152], 0, 'blob gone'); assert.equal(r.alpha[30 * w + 165], 0, 'blob gone');
  assert.equal(r.alpha[60 * w + 160], 255, 'second subject kept'); assert.equal(r.alpha[60 * w + 120], 120, 'soft edge next to a kept subject untouched');
  assert.equal(a[102 * w + 152], 255, 'input never modified');
  const same = R.keepMainSubject(r.alpha, w, h); assert.equal(same.removed, 0, 'idempotent');
  assert.equal(R.keepMainSubject(a, w, h, { minRel: 0 }).removed, 0, 'minRel 0 disables');
  const empty = R.keepMainSubject(new Uint8Array(w * h), w, h); assert.equal(empty.removed, 0);
  const one = new Uint8Array(w * h); one.fill(255); assert.equal(R.keepMainSubject(one, w, h).removed, 0, 'single component untouched');
}

console.log('matte-refine: all assertions passed (spill error ' + before.toFixed(1) + ' -> ' + after.toFixed(1) + ')');
