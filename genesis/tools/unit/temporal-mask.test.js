const assert = require('assert');
const { fuse, motionAmount } = require('../../js/providers/temporal-mask.js');
const N = 1024;
// 1) first frame: copy, not alias
const a = new Uint8Array(N).fill(100); const s0 = fuse(null, a); assert.notStrictEqual(s0, a); assert.deepStrictEqual([...s0.slice(0, 3)], [100, 100, 100]);
// 2) identical frames never change state
const s1 = fuse(Uint8Array.from(a), a); assert.ok(s1.every((v) => v === 100));
// 3) small flicker (+-6) on a still scene is damped: result moves less than the flicker
const prev = new Uint8Array(N).fill(100), cur = new Uint8Array(N).fill(106);
fuse(prev, cur); assert.ok(prev[0] > 100 && prev[0] < 106 && prev[0] <= 103, 'damped, got ' + prev[0]);
// 4) a real edge change (+120) is followed almost fully on the changed pixels while the rest stays put
const p4 = new Uint8Array(N).fill(100), c4 = new Uint8Array(N).fill(100); for (let i = 0; i < 16; i++) c4[i] = 220;
fuse(p4, c4); assert.ok(p4[0] >= 215, 'edge follows, got ' + p4[0]); assert.strictEqual(p4[500], 100);
// 5) whole-frame motion follows the new alpha strongly even for modest differences
const p5 = new Uint8Array(N).fill(60), c5 = new Uint8Array(N).fill(120); fuse(p5, c5); assert.ok(p5[0] >= 118, 'motion follows, got ' + p5[0]);
// 6) size change resets; values stay in 0..255 and convergence reaches the target
const p6 = fuse(new Uint8Array(8), new Uint8Array(N).fill(255)); assert.strictEqual(p6.length, N);
let st = new Uint8Array(N).fill(0); const tgt = new Uint8Array(N).fill(8); for (let i = 0; i < 20; i++) fuse(st, tgt); assert.strictEqual(st[0], 8);
assert.strictEqual(motionAmount(null, a), 1);
console.log('temporal-mask: all assertions passed');
