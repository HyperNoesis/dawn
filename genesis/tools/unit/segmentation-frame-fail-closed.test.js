'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.resolve(__dirname, '../../js/app.js'), 'utf8');
const studio = fs.readFileSync(path.resolve(__dirname, '../../studio.html'), 'utf8');

// A failed immutable snapshot must never fall back to passing the moving camera
// video element into an asynchronous inference or candidate benchmark.
assert.doesNotMatch(app, /sourceFrame\s*\|\|\s*els\.video/,
  'async inference must not fall back to the mutable live video');
assert.doesNotMatch(app, /inferenceSnapshot\s*\|\|\s*els\.video/,
  'foreground inference must require an owned frame snapshot');
assert.doesNotMatch(app, /catch\s*\([^)]*\)\s*\{\s*sourceFrame\s*=\s*els\.video/,
  'candidate benchmarks must fail when frame capture fails');
assert.match(app, /never infer against the mutable live video after snapshot failure/,
  'async frame-capture failure must be explicit and fail closed');
assert.match(app, /if \(!maskSource\) maskSource = passCanvas/,
  'a missing trustworthy matte must pass the camera through instead of retaining a stale silhouette');
assert.match(app, /const staleMask = cachedMaskBitmap;[\s\S]{0,220}cachedMaskBitmap = null;[\s\S]{0,100}cachedMaskFramePacket = null/,
  'a failed async snapshot must invalidate the previous matte and its frame identity');
assert.match(studio, /js\/providers\/segmentation-frame-pool\.js/,
  'the bounded snapshot pool must load before app runtime');
assert.match(app, /segmentationFlight\.run\(\{\}, initialSegFrame/,
  'person bitmap decoding must hold its own source-frame lease');

console.log('segmentation-frame-fail-closed: no mutable-video inference fallback');
