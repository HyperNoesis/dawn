/* Bounded reuse pool for immutable camera-frame snapshot canvases. */
(function (root) {
  'use strict';

  function create(options) {
    options = options || {};
    const makeCanvas = options.createCanvas || (() => document.createElement('canvas'));
    const maxFree = Number.isSafeInteger(options.maxFree) ? Math.max(0, options.maxFree) : 1;
    const maxPixels = Number.isSafeInteger(options.maxPixels) ? Math.max(1, options.maxPixels) : 1920 * 1080;
    let free = [], freeSet = new WeakSet(), activeSet = new WeakSet();
    let allocated = 0, active = 0, reused = 0, peakActive = 0;

    function acquire(width, height) {
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
        throw new RangeError('Segmentation frame dimensions must be positive integers');
      }
      let canvas = free.pop();
      if (canvas) {
        freeSet.delete(canvas);
        reused++;
      } else {
        canvas = makeCanvas();
        if (!canvas || typeof canvas !== 'object') throw new Error('Could not allocate a segmentation frame canvas');
        allocated++;
      }
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      activeSet.add(canvas);
      active++;
      peakActive = Math.max(peakActive, active);
      return canvas;
    }

    function release(canvas) {
      if (!canvas || !activeSet.has(canvas)) return false;
      activeSet.delete(canvas);
      active = Math.max(0, active - 1);
      const pixels = Number(canvas.width) * Number(canvas.height);
      if (maxFree > 0 && free.length < maxFree && Number.isFinite(pixels) && pixels <= maxPixels) {
        free.push(canvas);
        freeSet.add(canvas);
        return true;
      }
      try { canvas.width = 1; canvas.height = 1; } catch (e) { /* best effort memory release */ }
      return false;
    }

    function clear() {
      for (const canvas of free) {
        try { canvas.width = 1; canvas.height = 1; } catch (e) { /* best effort */ }
      }
      free = [];
      freeSet = new WeakSet();
    }

    return {
      acquire,
      release,
      clear,
      stats() { return { allocated, active, free: free.length, reused, peakActive, maxFree, maxPixels }; }
    };
  }

  const api = { create };
  root.VS = root.VS || {};
  root.VS.SegmentationFramePool = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
