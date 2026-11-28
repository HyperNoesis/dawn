// v1.01: UltraMatte default + governor engine lock.
const assert = require('assert');
global.self = global; global.window = global; global.VS = global.VS || {};
require('../../js/flags.js');
require('../../js/providers/quality-governor.js');
const G = global.VS.QualityGovernor;
const chain = [
  { engine: 'genesis-hybrid-tam', edges: [512, 448, 384, 320] },
  { engine: 'genesis-hybrid', edges: [320] },
  { engine: 'ppmatting-v2', edges: [320] },
  { engine: 'modnet', edges: [512, 448, 384, 320, 256, 224] }
];
function run(cfg) {
  const g = G.create(Object.assign({ chain, startEngine: 'genesis-hybrid-tam', startEdge: 512, now: 0 }, cfg || {}));
  const seen = new Set(['genesis-hybrid-tam']);
  let t = 0, emergency = false;
  for (let i = 0; i < 400; i++) {   // 400 s of a terrible device: ~3 fps, 500 ms masks
    t += 1000;
    const a = g.tick({ t, fps: 3, camFps: 30, segMs: 500, busy: false, stalls: 0 });
    if (a && a.type !== 'hold') { g.applied(a, t); if (a.emergency) emergency = true; else seen.add(a.engine); }
  }
  return { seen, emergency, state: g.state() };
}
assert.strictEqual(global.VS.Flags.get('ultraDefault'), 1, 'flag defaults on');
const locked = run();
assert.deepStrictEqual([...locked.seen], ['genesis-hybrid-tam'], 'locked governor never leaves UltraMatte: ' + [...locked.seen]);
assert.strictEqual(locked.emergency, false, 'locked governor never goes to the light model');
assert.ok(locked.state.rung.edge >= 320, 'size floor holds at 320, got ' + locked.state.rung.edge);
const free = run({ lockEngine: false });
assert.ok(free.seen.size > 1 || free.emergency, 'unlocked governor still degrades (control)');
console.log('ultra-lock tests passed');
