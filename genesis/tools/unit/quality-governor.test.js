// Simulated sessions for VS.QualityGovernor. The "device" model: mask time = k[engine] * (edge/100)^2 * load(t) (+15 % fixed), output fps = min(camera, 1000/(mask+render)).
const assert = require('assert'); const G = require('../../js/providers/quality-governor.js');
const CHAIN2 = [{ engine: 'pp', edges: [512, 448, 384, 320] }, { engine: 'modnet', edges: [512, 448, 384, 320, 256, 224] }];
function sim(o) {
  const kk = Object.assign({ modnet: 1.2, pp: 0.9 }, o.k); const known = o.known ? { pp: kk.pp * o.speed, modnet: kk.modnet * o.speed } : undefined;
  const gov = G.create({ costFactor: known, chain: o.chain || [{ engine: 'modnet', edges: [512, 448, 384, 320, 256, 224] }], startEngine: o.engine || 'modnet', startEdge: o.edge || 512, emergency: o.emergency === undefined ? 'mediapipe' : o.emergency });
  let engine = o.engine || 'modnet', edge = o.edge || 512, emergency = false, restarts = 0; const log = []; let busy = false;
  const k = Object.assign({ modnet: 1.2, pp: 0.9 }, o.k);            // ms per (edge/100)^2 at load 1: modnet 512 -> ~1.05 ms*... scaled by o.speed below
  for (let t = 0; t <= o.seconds * 1000; t += 1000) {
    const load = typeof o.load === 'function' ? o.load(t / 1000) : (o.load || 1);
    busy = o.busy ? o.busy(t / 1000) : false;
    let seg;
    if (emergency) seg = 8 * load; else { const u = (edge * edge) / 1e4; seg = (k[engine] * o.speed * u * 0.85 + k[engine] * o.speed * 25 * 0.15) * load; }
    const render = o.render || 8, cam = o.cam || 30;
    const fps = Math.min(cam, 1000 / (seg + render));
    const stalls = o.stall && o.stall(t / 1000) ? 1 : 0;
    const a = gov.tick({ t, fps, camFps: o.camKnown === false ? 0 : cam, segMs: seg, busy, stalls });
    if (a.type !== 'hold') {
      log.push(Object.assign({ at: t / 1000 }, a));
      if (o.failApply && o.failApply(a)) { gov.failed(a, t); continue; }
      gov.applied(a, t); if (a.emergency) { emergency = true; } else { emergency = false; engine = a.engine; edge = a.edge; }
      if (a.type === 'restart') restarts++;
    }
  }
  return { log, engine, edge, emergency, gov, restarts };
}
const moves = (r) => r.log.map((m) => m.type + ':' + (m.emergency ? 'light' : m.engine + m.edge) + '@' + m.at);

// 1. fast device never moves in 5 minutes
{ const r = sim({ seconds: 300, speed: 1 }); assert.equal(r.log.length, 0, 'fast device: no changes ' + moves(r)); assert.equal(r.edge, 512); }
// 2. a short spike (3 s of 6x slower) never changes the engine or size
{ const r = sim({ seconds: 120, speed: 1, load: (t) => (t > 40 && t < 43 ? 6 : 1) }); assert.equal(r.log.length, 0, 'transient spike ignored ' + moves(r)); }
// 3. warm-up slowness right after a change is ignored (settle)
{ const r = sim({ seconds: 60, speed: 60, load: 1 }); assert(r.log.length >= 1, 'sustained overload does step'); assert(r.log[0].at >= 5.5, 'but not before a window has been observed: ' + r.log[0].at); }
// 4. sustained 2.2x overload: a few small steps, never the light model, still matting at the end
{ const r = sim({ seconds: 240, speed: 2.4 }); assert(!r.emergency, 'no light model for a 2x overload'); assert(r.log.length >= 1 && r.log.length <= 4, 'few moves: ' + moves(r)); assert(r.log.every((m) => m.type === 'resize'), 'sizes only'); assert(r.edge < 512 && r.edge >= 224); const fpsEnd = 1000 / ((0.04 * 2.4 * ((r.edge * r.edge) / 1e4) * 0.85 + 0.04 * 2.4 * 25 * 0.15) + 8); assert(fpsEnd >= 17, 'ended at a rung that holds the floor: ' + fpsEnd + ' ' + moves(r)); }
// 5. thermal ramp up then cool down: goes down, then CLIMBS BACK to the top (unlimited recovery)
{ const r = sim({ seconds: 900, speed: 2.4, load: (t) => (t < 200 ? 1 : 0.15) }); assert(r.log.some((m) => !m.up), 'went down'); assert(r.log.some((m) => m.up), 'and climbed'); assert.equal(r.edge, 512, 'back at full quality after cooling: ' + moves(r)); assert(!r.emergency); }
// 6. a hopeless device (4.7 s per mask): predicted jump near the floor (not a crawl), light model only after HOPELESS_SEC at the floor, and NOT within the first 10 s
{ const r = sim({ seconds: 180, speed: 300 }); const em = r.log.find((m) => m.emergency); assert(em, 'hopeless device eventually uses the light model: ' + moves(r)); assert(em.at >= 16, 'not an instant fallback: ' + em.at); assert(r.log[0].at >= 6 && r.log[0].at <= 9, 'first move after one window: ' + r.log[0].at); assert(r.log.filter((m) => m.type === 'resize').length <= 2, 'predicted landing, not a crawl: ' + moves(r)); }
// 7. ...and when that device gets a quiet moment (load drops) it comes back from the light model on its own
{ const r = sim({ seconds: 900, speed: 300, load: (t) => (t < 120 ? 1 : 0.01) }); assert(r.log.some((m) => m.emergency), 'went light'); assert(!r.emergency, 'came back to matting: ' + moves(r)); }
// 8. camera-bound (12 fps camera, fast mask) is never treated as pressure
{ const r = sim({ seconds: 120, speed: 1, cam: 12 }); assert.equal(r.log.length, 0); }
{ const r = sim({ seconds: 120, speed: 3, cam: 12 }); assert(r.log.length <= 1, 'camera-bound even with a modest mask: ' + moves(r)); }
// 9. a stall restarts at a smaller size at once; three in a minute -> light model
{ const r = sim({ seconds: 30, speed: 1, stall: (t) => t === 10 }); assert.equal(r.log[0].type, 'restart'); assert.equal(r.log[0].edge, 448); assert(!r.emergency);
  const r3 = sim({ seconds: 60, speed: 1, stall: (t) => t === 10 || t === 20 || t === 30 }); assert(r3.log.some((m) => m.type === 'emergency'), '3 stalls: light model ' + moves(r3)); }
// 10. recording: sizes may change, engine swaps may not
{ const r = sim({ seconds: 200, speed: 4, chain: CHAIN2, engine: 'pp', edge: 512, busy: () => true, k: { pp: 0.9, modnet: 0.6 } }); assert(r.log.every((m) => m.type !== 'swap-engine'), 'no engine swap while recording ' + moves(r)); assert(r.log.some((m) => m.type === 'resize'), 'but it still resizes (no slideshow lock): ' + moves(r)); }
// 11. chain: PP -> MODNet only after PP's sizes are used up AND MODNet is predicted cheaper
{ const r = sim({ seconds: 400, speed: 5, chain: CHAIN2, engine: 'pp', edge: 512, known: true, k: { pp: 1.8, modnet: 0.9 } }); const sw = r.log.find((m) => m.type === 'swap-engine'); assert(sw, 'swaps when MODNet is the cheaper one: ' + moves(r)); const lastPP = r.log.filter((m) => m.engine === 'pp').pop(); assert(!lastPP || lastPP.edge >= 320, 'stayed inside PP sizes first'); }
{ const r = sim({ seconds: 400, speed: 5, chain: CHAIN2, engine: 'pp', edge: 512, known: true, k: { pp: 0.9, modnet: 2.0 } }); assert(r.log.every((m) => m.type !== 'swap-engine'), 'PP stays while it is the cheaper one (known costs): ' + moves(r)); assert(r.engine === 'pp'); }
{ const r = sim({ seconds: 400, speed: 5, chain: CHAIN2, engine: 'pp', edge: 512, k: { pp: 0.9, modnet: 2.0 } }); assert(r.log.length <= 8, 'unknown engine cost: bounded, no thrash: ' + moves(r)); }
// 12. a borderline device cannot oscillate: bounded moves in 20 minutes (probe back-off)
{ const r = sim({ seconds: 1200, speed: 2.6, load: (t) => 1 + 0.25 * Math.sin(t / 25) }); assert(r.log.length <= 14, 'bounded moves for a borderline device: ' + r.log.length + ' ' + moves(r)); }
// 13. a move the app could not apply (engine failed to load) is not assumed: the governor stays and waits a dwell before asking again
{ let n = 0; const r = sim({ seconds: 60, speed: 60, failApply: () => (n++ < 1) }); assert(r.log.length >= 2, 'asks again after a failure ' + moves(r)); assert(r.log[1].at - r.log[0].at >= 7, 'but not at once: ' + (r.log[1].at - r.log[0].at)); }
// 14. emergency can be disabled (never use the light model)
{ const r = sim({ seconds: 120, speed: 300, emergency: null }); assert(!r.emergency); }
// 15. unknown camera rate still works
{ const r = sim({ seconds: 120, speed: 2.6, camKnown: false }); assert(r.log.length >= 1 && !r.emergency, moves(r)); }
// 16. cost model learns and predicts within 25 % across sizes
{ const g = G.create({ chain: [{ engine: 'm', edges: [512, 256] }], startEngine: 'm', startEdge: 512 }); const rs = g.rungs(); const p = g.predictMs(rs[1], rs[0], 100); assert(p > 30 && p < 50, 'predict 256 from 100 ms @512: ' + p); }

/*
 * 20. Genesis UltraMatte has an explicit, quality-ordered live fallback chain:
 * EdgeTAM + Hybrid -> Hybrid -> PP-MattingV2 -> MODNet sizes. A simulated
 * slow phone must walk those routes in order, not immediately abandon the
 * advanced stack for the light model.
 */
{
  const adaptive = [
    { engine: 'genesis-hybrid-tam', edges: [512, 448, 384, 320] },
    { engine: 'genesis-hybrid', edges: [320] },
    { engine: 'ppmatting-v2', edges: [320] },
    { engine: 'modnet', edges: [512, 448, 384, 320, 256, 224] },
  ];
  const rungs = G.buildRungs(adaptive, 'genesis-hybrid-tam', 384);
  assert.deepStrictEqual(
    rungs.map((r) => [r.engine, r.edge]),
    [
      ['genesis-hybrid-tam', 512], ['genesis-hybrid-tam', 448],
      ['genesis-hybrid-tam', 384], ['genesis-hybrid-tam', 320],
      ['genesis-hybrid', 320], ['ppmatting-v2', 320],
      ['modnet', 512], ['modnet', 448], ['modnet', 384],
      ['modnet', 320], ['modnet', 256], ['modnet', 224],
    ],
    'adaptive rung order retains every advanced route before MODNet'
  );

  const factor = { 'genesis-hybrid-tam': 30, 'genesis-hybrid': 18, 'ppmatting-v2': 12, modnet: 9 };
  const g = G.create({
    chain: adaptive, startEngine: 'genesis-hybrid-tam', startEdge: 384,
    costFactor: factor, emergency: null
  });
  let engine = 'genesis-hybrid-tam', edge = 384;
  const swaps = [];
  for (let t = 0; t <= 600000; t += 1000) {
    const segMs = factor[engine] * (edge * edge / 1e4);
    const fps = Math.min(30, 1000 / (segMs + 8));
    const action = g.tick({ t, fps, camFps: 30, segMs, busy: false, stalls: 0 });
    if (action.type !== 'hold') {
      g.applied(action, t);
      if (!action.emergency) { engine = action.engine; edge = action.edge; }
      swaps.push(action);
    }
  }
  const engineOrder = [...new Set(swaps.filter((a) => !a.emergency).map((a) => a.engine))];
  assert.deepStrictEqual(
    engineOrder,
    ['genesis-hybrid-tam', 'genesis-hybrid', 'ppmatting-v2', 'modnet'],
    'a constrained device degrades through each matting tier before smaller MODNet'
  );
  assert.strictEqual(engine, 'modnet');
  assert.strictEqual(edge, 224, 'the simulated constrained device reaches the smallest responsive matting rung');
}

console.log('quality-governor: all assertions passed');

// 17. (found by the live heat emulation) a mask of ~350 ms at the smallest size is a 3 fps slideshow but below HOPELESS_MS: must still reach the light model after SLIDESHOW_SEC, and not before
{ const r = sim({ seconds: 120, speed: 36 }); const em = r.log.find((m) => m.emergency); assert(em, 'slideshow at the floor reaches the light model: ' + moves(r)); assert(em.at >= 15, 'not instantly: ' + em.at); }
// 18. camera-bound at a low camera rate is NOT a slideshow
{ const r = sim({ seconds: 120, speed: 1, cam: 6 }); assert(!r.emergency && r.log.length === 0, 'camera-bound 6 fps never escalates ' + moves(r)); }
// 19. the light model gives no gain (frame dominated by a 600 ms non-mask cost): go to light once, come back to matting, do NOT go light again for 10 min
{ const r = sim({ seconds: 400, speed: 15, render: 600 }); const em = r.log.filter((m) => m.emergency); assert.equal(em.length, 1, 'exactly one emergency: ' + moves(r)); assert(r.log.some((m) => /no gain/.test(m.why || '')), 'returned because it gave no gain: ' + moves(r)); assert(!r.emergency, 'ends on matting, not light'); }
