const assert = require('assert');
const { create } = require('../../js/providers/frame-epoch.js');

const gate = create();
const A = {}, B = {};
const geo = { width: 640, height: 480, orientation: 0 };
const st = (o) => Object.assign({ loopToken: 1, provider: A, geometry: geo }, o);

// happy path
let t1 = gate.begin(st());
assert.deepStrictEqual(gate.accept(t1, st()), { ok: true });

// a result can never be accepted twice nor overwrite a newer one
let t2 = gate.begin(st()), t3 = gate.begin(st());
assert.strictEqual(gate.accept(t3, st()).ok, true);
assert.strictEqual(gate.accept(t2, st()).reason, 'older-than-accepted', 'late older result must not overwrite a newer matte');
assert.strictEqual(gate.accept(t3, st()).ok, false, 'replayed result rejected');

// provider switched while worker promise outstanding
let t4 = gate.begin(st());
assert.strictEqual(gate.accept(t4, st({ provider: B })).reason, 'provider-changed');

// camera stop/restart => loop token changes
let t5 = gate.begin(st());
assert.strictEqual(gate.accept(t5, st({ loopToken: 2 })).reason, 'camera-session-changed');

// orientation / resize / front-back switch => geometry changes
let t6 = gate.begin(st());
assert.strictEqual(gate.accept(t6, st({ geometry: { width: 480, height: 640, orientation: 90 } })).reason, 'source-geometry-changed');
let t6b = gate.begin(st());
assert.strictEqual(gate.accept(t6b, st({ geometry: { width: 640, height: 480, orientation: 180 } })).reason, 'source-geometry-changed');

// cache reset (engine swap, scene cut, tab resume) invalidates all outstanding tickets
let t7 = gate.begin(st());
gate.bump('engine-switch');
assert.strictEqual(gate.accept(t7, st()).reason, 'superseded-epoch:engine-switch');
let t8 = gate.begin(st());
assert.strictEqual(gate.accept(t8, st()).ok, true, 'tickets issued after the bump are valid');

// missing ticket (snapshot failed) is rejected, never accepted blindly
assert.strictEqual(gate.accept(null, st()).reason, 'no-ticket');

const s = gate.stats();
assert.strictEqual(s.rejected['older-than-accepted'], 2);
assert.strictEqual(s.rejected['provider-changed'], 1);
assert.strictEqual(s.rejected['superseded-epoch'], 1);
console.log('frame-epoch: all assertions passed', JSON.stringify(s));
