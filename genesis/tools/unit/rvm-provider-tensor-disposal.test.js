'use strict';
const assert = require('assert');
global.window = global;
global.VS = {};
require('../../js/providers/rvm-provider.js');

(async () => {
  let disposed = 0, released = 0;
  class FakeTensor {
    constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; }
    dispose() { disposed++; }
  }
  global.ort = { Tensor: FakeTensor };
  const oldState = Array.from({ length: 4 }, () => new FakeTensor('float32', new Float32Array([0]), [1, 1, 1, 1]));
  const nextState = Array.from({ length: 4 }, () => new FakeTensor('float32', new Float32Array([1, 2]), [1, 1, 1, 2]));
  const alpha = new FakeTensor('float32', new Float32Array(32 * 32).fill(0.5), [1, 1, 32, 32]);
  const provider = Object.create(global.VS.RVMSegmentationProvider.prototype);
  Object.assign(provider, {
    config: { downsampleRatio: 0.5 },
    _rec: oldState,
    _prepareInput: () => ({ width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) }),
    _outImageData: { data: new Uint8ClampedArray(32 * 32 * 4) },
    _outCtx: { putImageData() {} },
    _outCanvas: { width: 32, height: 32 },
    session: {
      async run(feeds) {
        assert.ok(feeds.src instanceof FakeTensor);
        assert.ok(feeds.downsample_ratio instanceof FakeTensor);
        assert.deepStrictEqual([feeds.r1i, feeds.r2i, feeds.r3i, feeds.r4i], oldState);
        return { r1o: nextState[0], r2o: nextState[1], r3o: nextState[2], r4o: nextState[3], pha: alpha };
      },
      release() { released++; }
    }
  });
  const result = await provider.segment({});
  assert.ok(result.segmentationMask);
  assert.deepStrictEqual(provider._rec, nextState, 'new recurrent tensors are retained for the next frame');
  assert.strictEqual(disposed, 7, 'two transient inputs, four superseded recurrent states and alpha output are released');

  provider._resetRecurrentState();
  assert.strictEqual(disposed, 11, 'resolution reset releases the previous recurrent state');
  assert.strictEqual(provider._rec.length, 4);
  provider.dispose();
  assert.strictEqual(disposed, 15, 'dispose releases the final recurrent tensors');
  assert.strictEqual(released, 1, 'dispose releases the ONNX session');
  console.log('rvm-provider-tensor-disposal: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
