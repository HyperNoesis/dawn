const assert = require('assert');
const P = require('../../js/providers/engine-policy.js');

// device tiers
assert.strictEqual(P.tier({ mobile: true, cores: 8, memGB: 6 }), 'mid');
assert.strictEqual(P.tier({ mobile: true, cores: 8, memGB: 2 }), 'low');
assert.strictEqual(P.tier({ mobile: true, cores: 4, memGB: 8 }), 'low');
assert.strictEqual(P.tier({ cores: 12, memGB: 16, webgpu: true }), 'high');
assert.strictEqual(P.tier({ cores: 8, memGB: 16, webgpu: false }), 'mid');
assert.strictEqual(P.tier({ cores: 2, memGB: 8 }), 'low');
assert.strictEqual(P.tier(), 'low');

// live order: beta only when flag on AND user picked it; previous default always present
let r = P.liveOrder({ device: { cores: 8, memGB: 16, webgpu: true }, flags: { ppmattingBeta: 1 }, pref: 'ppmatting-v2' });
assert.deepStrictEqual(r.order, ['ppmatting-v2', 'modnet', 'mediapipe']);
r = P.liveOrder({ device: { cores: 8, memGB: 16 }, flags: { ppmattingBeta: 0 }, pref: 'ppmatting-v2' });
assert.deepStrictEqual(r.order, ['modnet', 'mediapipe']); assert.ok(r.reasons.some((x) => /flag is off/.test(x)));
r = P.liveOrder({ device: { cores: 8, memGB: 16 }, flags: { ppmattingBeta: 1 } });                 // not picked: default order untouched
assert.deepStrictEqual(r.order, ['modnet', 'mediapipe']);
r = P.liveOrder({ device: { mobile: true, cores: 4, memGB: 3 }, flags: { ppmattingBeta: 1 }, pref: 'ppmatting-v2' });
assert.deepStrictEqual(r.order, ['mediapipe', 'modnet']); assert.ok(!r.order.includes('ppmatting-v2'));
r = P.liveOrder({ device: { cores: 8, memGB: 16 }, flags: { ppmattingBeta: 1 }, pref: 'ppmatting-v2', measured: { 'ppmatting-v2': { p95Ms: 80 } } });
assert.ok(!r.order.includes('ppmatting-v2'), 'over budget -> fall back'); assert.ok(r.order.includes('modnet'));
for (const d of [{}, { mobile: true }, { cores: 16, memGB: 32, webgpu: true }]) assert.ok(P.liveOrder({ device: d, flags: { ppmattingBeta: 1 }, pref: 'ppmatting-v2' }).order.includes('modnet'), 'modnet is always a last resort');

// export engine
assert.strictEqual(P.exportEngine({ device: { cores: 8, memGB: 16 }, flags: { ppmattingBeta: 1 } }).engine, 'ppmatting-hrnet');
assert.strictEqual(P.exportEngine({ device: { mobile: true, cores: 4, memGB: 2 } }).engine, 'ppmatting-v2');
assert.strictEqual(P.exportEngine({ flags: { ppmattingBeta: 0 } }).engine, null);

// stop condition
assert.deepStrictEqual([P.placement({ sadRatio: 0.8, dtssdRatio: 1.4 }).live, P.placement({ sadRatio: 0.8, dtssdRatio: 1.4 }).export], [false, true]);
assert.strictEqual(P.placement({ sadRatio: 0.9, dtssdRatio: 0.9 }).live, true);
assert.strictEqual(P.placement({ sadRatio: 1.3, dtssdRatio: 1.3 }).live, false);
assert.strictEqual(P.placement({ sadRatio: 1.3, dtssdRatio: 0.8 }).live, true);

// release gate: missing numbers are PENDING, never pass; one fail blocks; promotion needs gate AND flag
let g = P.evaluateGate({});
assert.strictEqual(g.pass, false); assert.ok(g.pending.length >= 10 && g.failed.length === 0);
const good = { fps: 28, p95Ms: 35, flickerRatio: 0.7, sadRatio: 0.9, gradRatio: 0.95, memGrowthMB: 40, sessionMinutes: 15, recoveryFailures: 0, blackFrames: 0, uploadsFrames: false, manual: { hairFingers: true, realDevice: true, licenceReviewed: true } };
g = P.evaluateGate(good); assert.strictEqual(g.pass, true, JSON.stringify(g));
assert.strictEqual(P.canPromote(g, { promotePPMatting: 0 }), false); assert.strictEqual(P.canPromote(g, {}), false); assert.strictEqual(P.canPromote(g, { promotePPMatting: 1 }), true);
g = P.evaluateGate(Object.assign({}, good, { fps: 18 })); assert.deepStrictEqual(g.failed, ['fps']); assert.strictEqual(P.canPromote(g, { promotePPMatting: 1 }), false);
g = P.evaluateGate(Object.assign({}, good, { uploadsFrames: true })); assert.ok(g.failed.includes('localOnly'));
g = P.evaluateGate(Object.assign({}, good, { blackFrames: 3 })); assert.ok(g.failed.includes('recovery'));
g = P.evaluateGate(Object.assign({}, good, { manual: { hairFingers: true } })); assert.ok(g.pending.includes('realDevice') && g.pass === false);

// --- v0.95 measured-speed memory
{
  const mem = {}, store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  assert.equal(P.isSlow('ppmatting-v2', undefined, store), false, 'no record = no opinion');
  assert.equal(P.recordMeasured('ppmatting-v2', 300, 10, store), false, 'runs under 30 frames are ignored');
  assert.equal(P.recordMeasured('ppmatting-v2', 300, 40, store), true);
  assert.equal(P.isSlow('ppmatting-v2', undefined, store), true, '300 ms p95 is unusable');
  assert.equal(P.isSlow('modnet', undefined, store), false, 'other engines unaffected');
  P.recordMeasured('ppmatting-v2', 40, 60, store); assert.equal(P.isSlow('ppmatting-v2', undefined, store), false, 'a later fast run clears it');
  assert.equal(P.recordMeasured('x', NaN, 99, store), false); mem['vs_measured'] = '{broken'; assert.deepEqual(P.getMeasured(store), {}, 'corrupt store is survivable');
}

console.log('engine-policy: all assertions passed');
