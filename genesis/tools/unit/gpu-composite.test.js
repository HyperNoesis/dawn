const assert = require('assert'), G = require('../../js/providers/gpu-composite.js');
const near = (a, b, t) => a.every((v, i) => Math.abs(v - b[i]) <= t);
// alpha 0 -> background, alpha 1 -> foreground (exact), in both linear and gamma modes
assert.ok(near(G.compositeCPU([200, 10, 30], [5, 100, 250], 0), [5, 100, 250], 0.6)); assert.ok(near(G.compositeCPU([200, 10, 30], [5, 100, 250], 1), [200, 10, 30], 0.6));
assert.ok(near(G.compositeCPU([200, 10, 30], [5, 100, 250], 0, false), [5, 100, 250], 1e-9));
// alpha clamped; out-of-range / NaN-free
assert.ok(near(G.compositeCPU([200, 10, 30], [5, 100, 250], 1.7), [200, 10, 30], 0.6)); assert.ok(near(G.compositeCPU([200, 10, 30], [5, 100, 250], -3), [5, 100, 250], 0.6));
// linear-light blend of black and white at 0.5 is brighter than the gamma-space average (the halo-avoidance property)
const lin = G.compositeCPU([255, 255, 255], [0, 0, 0], 0.5)[0], gam = G.compositeCPU([255, 255, 255], [0, 0, 0], 0.5, false)[0];
assert.ok(lin > gam + 30, 'linear ' + lin.toFixed(1) + ' vs gamma ' + gam.toFixed(1));
// round trip sRGB <-> linear is the identity
for (let v = 0; v <= 255; v += 5) assert.ok(Math.abs(G.linToSrgb(G.srgbToLin(v)) - v) < 1e-6);
// monotonic in alpha
let prev = -1; for (let a = 0; a <= 1.0001; a += 0.1) { const v = G.compositeCPU([255, 255, 255], [0, 0, 0], a)[0]; assert.ok(v >= prev); prev = v; }
// no WebGPU here: unsupported, create resolves null (caller keeps WebGL), never throws
(async () => { assert.strictEqual(G.isSupported(), false); assert.strictEqual(await G.create({}), null); console.log('gpu-composite: all assertions passed (CPU reference only; shader NOT run on a GPU)'); })();
