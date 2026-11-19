const assert = require('assert');
const B = require('../../js/providers/matte-band.js');
const W = 256, H = 192;
// disc person with a soft 6px edge
const a = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.hypot(x - 128, y - 96) - 60; a[y * W + x] = d < -3 ? 255 : d > 3 ? 0 : Math.round(127.5 - d * 42); }
let p = B.plan(a, W, H, { budget: 50 });
assert(p.tiles.length > 0 && p.tiles.length < p.stats.tilesTotal, 'only edge tiles picked');
assert(p.tiles.every((t) => t.x >= 0 && t.y >= 0 && t.x + t.w <= W && t.y + t.h <= H), 'tiles inside the frame');
for (let i = 1; i < p.tiles.length; i++) assert(p.tiles[i - 1].score >= p.tiles[i].score, 'best first');
// budget cap
p = B.plan(a, W, H, { budget: 3 }); assert.strictEqual(p.tiles.length, 3);
p = B.plan(a, W, H, { budget: 0 }); assert.strictEqual(p.tiles.length, 0);
// crisp matte (no soft pixels) -> nothing to refine
const crisp = a.map((v) => (v > 127 ? 255 : 0)); p = B.plan(crisp, W, H); assert.strictEqual(p.tiles.length, 0);
// tracker disagreement on a crisp matte: a stray blob only the matte has
const trk = new Uint8Array(crisp); const stray = new Uint8Array(crisp);
for (let y = 10; y < 40; y++) for (let x = 10; x < 40; x++) stray[y * W + x] = 255;
p = B.plan(stray, W, H, { tracker: trk }); assert(p.tiles.length > 0 && p.stats.disagreePct > 0, 'disagreement raises tiles');
assert(p.tiles.some((t) => t.x < 48 && t.y < 48), 'tile sits on the stray blob');
// wrong-size tracker is ignored, not a crash
p = B.plan(crisp, W, H, { tracker: new Uint8Array(5) }); assert.strictEqual(p.tiles.length, 0);
// scaleTiles
const s = B.scaleTiles([{ x: 8, y: 8, w: 64, h: 64, score: 1 }], W, H, W * 4, H * 4);
assert.deepStrictEqual([s[0].x, s[0].y, s[0].w, s[0].h], [32, 32, 256, 256]);
// pasteTile: centre fully replaced, border feathered, outside untouched
const dst = new Uint8Array(W * H).fill(0), tile = { x: 20, y: 20, w: 40, h: 40 }, src = new Uint8Array(40 * 40).fill(200);
B.pasteTile(dst, W, H, tile, src, 4);
assert.strictEqual(dst[40 * W + 40], 200); assert(dst[20 * W + 20] > 0 && dst[20 * W + 20] < 200); assert.strictEqual(dst[10 * W + 10], 0);
// refineTiles: accepts a faithful refinement, rejects one that rewrites confident pixels, survives a throwing runner, respects the deadline
(async () => {
  const t0 = B.plan(a, W, H, { budget: 4 }).tiles, same = async (t) => { const o = new Uint8Array(t.w * t.h); for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) o[y * t.w + x] = a[(t.y + y) * W + t.x + x]; return o; };
  let r = await B.refineTiles(a, W, H, t0, same); assert.strictEqual(r.accepted, t0.length); assert.deepStrictEqual(Array.from(r.alpha), Array.from(a), 'identity refinement changes nothing');
  r = await B.refineTiles(a, W, H, t0, async (t) => new Uint8Array(t.w * t.h).fill(255)); assert.strictEqual(r.rejected, t0.length); assert.deepStrictEqual(Array.from(r.alpha), Array.from(a), 'bad tiles never reach the matte');
  r = await B.refineTiles(a, W, H, t0, async () => { throw new Error('x'); }); assert.strictEqual(r.failed, t0.length);
  let clock = 0; r = await B.refineTiles(a, W, H, t0, async (t) => { clock += 30; return same(t); }, { deadlineMs: 50, now: () => clock }); assert(r.accepted >= 1 && r.skipped >= 1, 'deadline stops new tiles');
  assert(a.every((v, i) => v === Array.from(a)[i])); // raw untouched
  console.log('matte-band.test.js PASS');
})().catch((e) => { console.error(e); process.exit(1); });
