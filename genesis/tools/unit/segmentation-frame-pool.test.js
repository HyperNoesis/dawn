'use strict';
const assert = require('assert');
const Pool = require('../../js/providers/segmentation-frame-pool.js');

let creates = 0;
const pool = Pool.create({
  maxFree: 1,
  maxPixels: 1920 * 1080,
  createCanvas() { creates++; return { width:0, height:0 }; }
});

const first = pool.acquire(1280, 720);
assert.deepStrictEqual([first.width, first.height], [1280, 720]);
assert.strictEqual(pool.stats().active, 1);
assert.strictEqual(pool.release(first), true);
assert.strictEqual(pool.stats().free, 1);

const reused = pool.acquire(1280, 720);
assert.strictEqual(reused, first, 'a released frame canvas is reused only after its lease ends');
assert.strictEqual(creates, 1);
assert.strictEqual(pool.stats().reused, 1);
assert.strictEqual(pool.release(reused), true);
assert.strictEqual(pool.release(reused), false, 'double release cannot add the same canvas twice');
assert.strictEqual(pool.stats().free, 1);

const large = pool.acquire(3840, 2160);
assert.strictEqual(large, first);
assert.strictEqual(pool.release(large), false, 'oversized canvases are not retained in the pool');
assert.deepStrictEqual([large.width, large.height], [1, 1]);
assert.strictEqual(pool.stats().free, 0);

const small = pool.acquire(640, 360);
pool.release(small);
pool.clear();
assert.strictEqual(pool.stats().free, 0);
assert.deepStrictEqual([small.width, small.height], [1, 1]);
assert.strictEqual(pool.stats().active, 0);

const a = pool.acquire(320, 240);
const b = pool.acquire(320, 240);
assert.notStrictEqual(a, b, 'simultaneous source frames never share one canvas');
pool.release(a);
pool.release(b);
assert.strictEqual(pool.stats().free, 1, 'free canvas retention remains bounded');
assert.strictEqual(pool.stats().active, 0);
assert.ok(pool.stats().peakActive >= 2);
console.log('segmentation-frame-pool: bounded reuse and release assertions passed');
