const assert = require('assert');
const B = require('../../js/providers/band-refine-core.js');

// The quality allowance is incremental: coarse inference time must not consume it.
assert.strictEqual(B.tileBudget({ budgetMs: 60, tileMs: 20, maxTiles: 3 }), 3);
assert.strictEqual(B.tileBudget({ budgetMs: 45, tileMs: 20, maxTiles: 3 }), 2);
assert.strictEqual(B.tileBudget({ budgetMs: 10, tileMs: 20, maxTiles: 3 }), 0);
assert.strictEqual(B.tileBudget({ budgetMs: 100, tileMs: 20, maxTiles: 1 }), 1);

// Legacy callers still receive the old total-budget interpretation.
assert.strictEqual(B.tileBudget({ targetMs: 70, coarseMs: 50, tileMs: 10, maxTiles: 4 }), 2);
assert.strictEqual(B.tileBudget({ targetMs: 70, coarseMs: 90, tileMs: 10, maxTiles: 4 }), 0);

// A refinement that flips even one of very few confident pixels must fail.
const coarse = new Uint8Array(100).fill(128);
const refined = new Uint8Array(100).fill(128);
coarse[0] = 0;
refined[0] = 255;
assert.strictEqual(B.tileSane(coarse, refined), false);

// Matching confident pixels remain valid; uncertain pixels can still change.
const good = new Uint8Array(coarse);
good[0] = 0;
good[1] = 190;
assert.strictEqual(B.tileSane(coarse, good), true);
console.log('band-refine-budget: all assertions passed');
