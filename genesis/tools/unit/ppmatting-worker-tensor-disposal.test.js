'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

(async () => {
  let disposed = 0, released = 0;
  const responses = [];
  class FakeTensor {
    constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; }
    dispose() { disposed++; }
  }
  const output = new FakeTensor('float32', new Float32Array(32 * 32).fill(0.5), [1, 1, 32, 32]);
  const session = {
    inputNames: ['img'], outputNames: ['alpha'],
    async run(feeds) {
      assert.ok(feeds.img instanceof FakeTensor);
      return { alpha: output };
    },
    release() { released++; }
  };
  const core = {
    toTensor: (_rgba, w, h) => new Float32Array(3 * w * h),
    validateAlphaOutput: (data, expected) => ({ ok: data.length === expected }),
    toAlpha: (data, count) => Uint8Array.from(data.slice(0, count), (v) => Math.round(v * 255))
  };
  const self = {
    VS: {},
    performance: { now: () => Date.now() },
    postMessage: (message) => responses.push(message)
  };
  const context = {
    self, ort: {
      env: { wasm: {} },
      Tensor: FakeTensor,
      InferenceSession: { create: async () => session }
    },
    navigator: {},
    importScripts() { self.VS.PPMattingCore = core; },
    Uint8Array, Uint8ClampedArray, Float32Array, ArrayBuffer, Set, Promise, Date, Error,
    Object, Math, Number, String
  };
  const source = fs.readFileSync(path.join(__dirname, '../../js/providers/ppmatting-worker.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'ppmatting-worker.js' });

  await self.onmessage({ data: { id: 1, type: 'init', base: '/', bytes: new ArrayBuffer(1000000), gpu: false, threads: 1 } });
  assert.strictEqual(responses[0].type, 'ready');
  await self.onmessage({ data: { id: 2, type: 'run', w: 32, h: 32, rgba: new ArrayBuffer(32 * 32 * 4) } });
  assert.strictEqual(responses[1].type, 'result');
  assert.strictEqual(new Uint8Array(responses[1].alpha).length, 1024);
  assert.strictEqual(disposed, 2, 'PP-Matting input and output tensors are disposed after alpha extraction');
  await self.onmessage({ data: { id: 3, type: 'dispose' } });
  assert.strictEqual(released, 1, 'the ONNX session is released on worker disposal');
  console.log('ppmatting-worker-tensor-disposal: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
