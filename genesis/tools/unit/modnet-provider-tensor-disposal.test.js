'use strict';
const assert = require('assert');
global.window = global;
global.VS = {};
require('../../js/providers/modnet-provider.js');

(async () => {
  let disposed = 0;
  class FakeTensor {
    constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; }
    dispose() { disposed++; }
  }
  const output = new FakeTensor('float32', new Float32Array(32 * 32).fill(0.25), [1, 1, 32, 32]);
  const provider = Object.create(global.VS.MODNetSegmentationProvider.prototype);
  Object.assign(provider, {
    _inputName: 'input',
    _outputName: 'output',
    _mw: 32,
    _mh: 32,
    _draw: () => new Uint8ClampedArray(32 * 32 * 4),
    session: {
      async run(feeds) {
        assert.ok(feeds.input instanceof FakeTensor);
        return { output };
      }
    }
  });
  const result = await provider._run({});
  assert.deepStrictEqual(result.dims, [1, 1, 32, 32]);
  assert.strictEqual(result.data.length, 1024);
  assert.ok(result.data instanceof Float32Array, 'output is copied before the native ORT tensor is disposed');
  assert.strictEqual(disposed, 2, 'in-page MODNet input and output tensors are disposed');
  console.log('modnet-provider-tensor-disposal: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
