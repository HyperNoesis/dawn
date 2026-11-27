'use strict';
const assert = require('assert');
global.window = global;
global.VS = {
  MODNetSegmentationProvider: class {},
  EdgeTAMCore: { toPixelValues() {} }
};
require('../../js/providers/birefnet-provider.js');

(async () => {
  let disposed = 0, released = 0;
  class FakeTensor {
    constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; }
    dispose() { disposed++; }
  }
  const output = new FakeTensor('float32', new Float32Array(1024 * 1024).fill(0.5), [1, 1, 1024, 1024]);
  const provider = Object.create(global.VS.BiRefNetSegmentationProvider.prototype);
  Object.assign(provider, {
    temporal: false,
    _px: new Float32Array(3 * 1024 * 1024),
    _inCtx: {
      drawImage() {},
      getImageData() { return { data: new Uint8ClampedArray(1024 * 1024 * 4) }; }
    },
    _outCanvas: { width: 0, height: 0 },
    _outCtx: {
      createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
      putImageData() {}
    },
    _img: null,
    session: {
      async run(feeds) {
        assert.ok(feeds.image instanceof FakeTensor);
        return { output };
      },
      release() { released++; }
    },
    _inName: 'image',
    _outName: 'output'
  });
  const result = await provider.segment({ videoWidth: 1024, videoHeight: 1024 });
  assert.ok(result.segmentationMask);
  assert.strictEqual(provider._outCanvas.width, 512);
  assert.strictEqual(disposed, 2, 'BiRefNet input and output tensors are disposed after alpha extraction');
  provider.dispose();
  assert.strictEqual(released, 1, 'BiRefNet ONNX session is released');
  console.log('birefnet-provider-tensor-disposal: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
