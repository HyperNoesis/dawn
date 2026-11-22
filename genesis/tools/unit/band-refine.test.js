// Unit test for js/providers/band-refine-core.js (pure functions, node only). Exit code 1 on any failure.
const assert = require('assert');
const path = require('path');
const B = require(path.join(__dirname, '../../js/providers/band-refine-core.js'));
let pass = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// soft-edged disc alpha
function disc(w, h, cx, cy, r, soft) {
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - cx, y - cy), v = (r - d) / soft + 0.5;
    a[y * w + x] = Math.round(255 * Math.max(0, Math.min(1, v)));
  }
  return a;
}

t('buildBand marks the soft ring and not the confident interior or far background', () => {
  const w = 96, h = 96, a = disc(w, h, 48, 48, 30, 6);
  const band = B.buildBand(a, w, h, { dilate: 0 });
  assert.strictEqual(band[48 * w + 48], 0);       // centre
  assert.strictEqual(band[2 * w + 2], 0);         // corner
  assert.strictEqual(band[48 * w + 78], 1);       // on the edge (x = cx + r)
  assert.ok(B.count(band) > 100);
});

t('buildBand catches a hard 0/255 edge through the gradient rule', () => {
  const w = 32, h = 8, a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 16; x < w; x++) a[y * w + x] = 255;
  const band = B.buildBand(a, w, h, { dilate: 0 });
  assert.strictEqual(band[4 * w + 15], 1); assert.strictEqual(band[4 * w + 16], 1); assert.strictEqual(band[4 * w + 5], 0);
});

t('dilate grows by r in every direction', () => {
  const w = 21, h = 21, m = new Uint8Array(w * h); m[10 * w + 10] = 1;
  const d = B.dilate(m, w, h, 3);
  assert.strictEqual(d[10 * w + 13], 1); assert.strictEqual(d[10 * w + 14], 0); assert.strictEqual(d[13 * w + 10], 1); assert.strictEqual(d[14 * w + 10], 0);
});

t('feather keeps 255 inside a big region, 0 far away, and ramps at the edge', () => {
  const w = 64, h = 64, m = new Uint8Array(w * h);
  for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) m[y * w + x] = 1;
  const f = B.feather(m, w, h, 2);
  assert.strictEqual(f[32 * w + 32], 255); assert.strictEqual(f[2 * w + 2], 0);
  const edge = f[32 * w + 16]; assert.ok(edge > 0 && edge < 255);
});

t('pickTiles returns the busiest tile first and honours minCount and maxTiles', () => {
  const w = 256, h = 256, band = new Uint8Array(w * h);
  for (let y = 130; y < 150; y++) for (let x = 130; x < 150; x++) band[y * w + x] = 1;   // 400 px in tile (1,1)
  for (let x = 10; x < 20; x++) band[10 * w + x] = 1;                                     // 10 px in tile (0,0)
  const all = B.pickTiles(band, w, h, 128, { minCount: 5 });
  assert.strictEqual(all.length, 2); assert.strictEqual(all[0].key, '1,1'); assert.strictEqual(all[0].count, 400);
  assert.strictEqual(B.pickTiles(band, w, h, 128, { minCount: 50 }).length, 1);
  assert.strictEqual(B.pickTiles(band, w, h, 128, { minCount: 5, maxTiles: 1 }).length, 1);
});

t('pickTiles prioritizes textured uncertain boundaries when occupancy is equal', () => {
  const w = 256, h = 128, lw = 16, lh = 8, band = new Uint8Array(w * h);
  const luma = new Uint8Array(lw * lh).fill(100);
  // Equal one-sample-per-cell band occupancy in both 128px tiles.
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    const ax = Math.floor((x + 0.5) * w / lw), ay = Math.floor((y + 0.5) * h / lh);
    band[ay * w + ax] = 1;
    if (x < 8) luma[y * lw + x] = ((x + y) & 1) ? 220 : 20;
  }
  const ranked = B.pickTiles(band, w, h, 128, {
    minCount: 1, guideLuma: luma, guideWidth: lw, guideHeight: lh,
    textureWeight: 1.25, textureThreshold: 14
  });
  assert.strictEqual(ranked.length, 2);
  assert.strictEqual(ranked[0].key, '0,0');
  assert.strictEqual(ranked[0].count, ranked[1].count);
  assert.ok(ranked[0].textureDensity > ranked[1].textureDensity);
  assert.ok(ranked[0].score > ranked[1].score);
});

t('cropRect is always size x size, inside the image and covers the core', () => {
  const W = 768, H = 432, size = 192, margin = 32;
  for (const core of [{ x: 0, y: 0, w: 128, h: 128 }, { x: 640, y: 384, w: 128, h: 48 }, { x: 256, y: 128, w: 128, h: 128 }, { x: 640, y: 0, w: 128, h: 128 }]) {
    const c = B.cropRect(core, margin, W, H, size);
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= W && c.y + c.h <= H);
    assert.ok(c.x <= core.x && c.y <= core.y && c.x + c.w >= core.x + core.w && c.y + c.h >= core.y + core.h);
  }
});

t('extract copies exactly the core region', () => {
  const w = 20, h = 10, a = new Uint8Array(w * h); for (let i = 0; i < a.length; i++) a[i] = i & 255;
  const e = B.extract(a, { x: 5, y: 2, w: 4, h: 3 }, w);
  assert.strictEqual(e.length, 12); assert.strictEqual(e[0], a[2 * w + 5]); assert.strictEqual(e[11], a[4 * w + 8]);
});

t('mergeCore never touches pixels outside the band and fully replaces inside a solid band', () => {
  const w = 64, h = 64, dst = new Uint8Array(w * h).fill(100), core = { x: 0, y: 0, w: 32, h: 32 };
  const soft = new Uint8Array(w * h); for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) soft[y * w + x] = 255;
  B.mergeCore(dst, new Uint8Array(32 * 32).fill(200), core, soft, w);
  assert.strictEqual(dst[10 * w + 10], 200); assert.strictEqual(dst[20 * w + 20], 100); assert.strictEqual(dst[0], 100);
});

t('tileSane accepts a close tile and rejects one that flips confident pixels', () => {
  const n = 128 * 128, coarse = new Uint8Array(n).fill(255), good = new Uint8Array(n).fill(250), bad = new Uint8Array(n).fill(0);
  assert.ok(B.tileSane(coarse, good)); assert.ok(!B.tileSane(coarse, bad)); assert.ok(!B.tileSane(coarse, new Uint8Array(5)));
});

t('blockMotion recovers a global shift and the warp aligns the previous alpha', () => {
  const lw = 128, lh = 72, aw = 256, ah = 144, dx = 2, dy = 1;
  const prevL = new Uint8Array(lw * lh); for (let i = 0; i < prevL.length; i++) prevL[i] = (rnd() * 255) | 0;
  const curL = new Uint8Array(lw * lh);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) curL[y * lw + x] = prevL[Math.max(0, y - dy) * lw + Math.max(0, x - dx)];
  const mot = B.blockMotion(prevL, curL, lw, lh, { block: 8, range: 3 });
  const bi = 4 * mot.bw + 8;                                   // an interior block
  assert.strictEqual(mot.vx[bi], -dx); assert.strictEqual(mot.vy[bi], -dy);
  // alpha blob moves by (dx*2, dy*2) at alpha resolution (alpha is 2x luma)
  const prevA = disc(aw, ah, 100, 70, 25, 4), curA = disc(aw, ah, 100 + dx * 2, 70 + dy * 2, 25, 4);
  const warped = B.warpAlpha(prevA, aw, ah, mot, lw, lh);
  const before = B.meanAbsDiff(prevA, curA), after = B.meanAbsDiff(warped, curA);
  assert.ok(after < before * 0.4, 'warp should cut the error: before ' + before.toFixed(2) + ' after ' + after.toFixed(2));
});

t('blockMotion leaves flat or static blocks at zero', () => {
  const w = 64, h = 64, f = new Uint8Array(w * h).fill(90);
  const mot = B.blockMotion(f, f, w, h, {});
  assert.ok(mot.vx.every((v) => v === 0) && mot.vy.every((v) => v === 0));
});

t('gatedTemporal lowers edge flicker on a static scene and never exceeds the 0.25 history cap', () => {
  const w = 64, h = 64, lw = 64, lh = 64, mot = B.blockMotion(new Uint8Array(w * h), new Uint8Array(w * h), w, h, {});
  const base = disc(w, h, 32, 32, 20, 6);
  const noisy = () => { const a = Uint8Array.from(base); for (let i = 0; i < a.length; i++) if (a[i] > 12 && a[i] < 243) a[i] = Math.max(0, Math.min(255, a[i] + ((rnd() - 0.5) * 24) | 0)); return a; };
  const raw = [], out = []; let prev = null;
  for (let f = 0; f < 40; f++) {
    const cur = noisy(); raw.push(Uint8Array.from(cur));
    if (prev) B.gatedTemporal(cur, prev, w, h, mot, lw, lh, { hist: 0.9 });   // 0.9 must be clamped to 0.25
    out.push(Uint8Array.from(cur)); prev = Uint8Array.from(cur);
  }
  const fl = (fr) => { let s = 0, c = 0; for (let f = 1; f < fr.length; f++) for (let i = 0; i < fr[f].length; i++) { s += Math.abs(fr[f][i] - fr[f - 1][i]); c++; } return s / c; };
  const fr = fl(raw), fo = fl(out);
  assert.ok(fo < fr * 0.9, 'flicker raw ' + fr.toFixed(3) + ' out ' + fo.toFixed(3));
  const c = new Uint8Array([100]), p = new Uint8Array([104]);
  B.gatedTemporal(c, p, 1, 1, { vx: new Int8Array(1), vy: new Int8Array(1), res: new Float32Array(1), bw: 1, bh: 1, block: 8 }, 1, 1, { hist: 1 });
  assert.ok(c[0] <= 101, 'moved at most 25% of the gap: ' + c[0]);
});

t('gatedTemporal follows a large change at once and skips unreliable-motion blocks', () => {
  const mot = { vx: new Int8Array(1), vy: new Int8Array(1), res: new Float32Array(1), bw: 1, bh: 1, block: 8 };
  const c = new Uint8Array([200]); B.gatedTemporal(c, new Uint8Array([100]), 1, 1, mot, 1, 1, {});
  assert.strictEqual(c[0], 200);
  mot.res[0] = 50; const c2 = new Uint8Array([100]); B.gatedTemporal(c2, new Uint8Array([108]), 1, 1, mot, 1, 1, {});
  assert.strictEqual(c2[0], 100);
});

t('tileBudget: zero when coarse is over budget, capped by maxTiles, scales with room', () => {
  assert.strictEqual(B.tileBudget({ targetMs: 60, coarseMs: 70, tileMs: 10, maxTiles: 3 }), 0);
  assert.strictEqual(B.tileBudget({ targetMs: 60, coarseMs: 30, tileMs: 10, maxTiles: 3 }), 3);
  assert.strictEqual(B.tileBudget({ targetMs: 60, coarseMs: 45, tileMs: 10, maxTiles: 3 }), 1);
});

t('performance: band + feather + motion + warp + temporal on 768x432 stays cheap', () => {
  const aw = 768, ah = 432, lw = 128, lh = 72, a = disc(aw, ah, 380, 220, 150, 10);
  const L0 = new Uint8Array(lw * lh); for (let i = 0; i < L0.length; i++) L0[i] = (rnd() * 255) | 0;
  const t0 = process.hrtime.bigint();
  const band = B.buildBand(a, aw, ah, { dilate: 3 }); B.feather(band, aw, ah, 2);
  const mot = B.blockMotion(L0, L0, lw, lh, {}); const wp = B.warpAlpha(a, aw, ah, mot, lw, lh); B.gatedTemporal(Uint8Array.from(a), wp, aw, ah, mot, lw, lh, {});
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('     (node, server CPU, not a phone) ' + ms.toFixed(1) + ' ms per frame for the non-model work');
  assert.ok(ms < 400);
});

console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
