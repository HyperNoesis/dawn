'use strict';
const assert = require('assert');
const { webcrypto } = require('crypto');
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
}
globalThis.VS = globalThis.VS || {};
globalThis.fetch = async (path) => {
  const bytes = new TextEncoder().encode('test-resource:' + String(path));
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
};

(async () => {
  const Identity = require('../../js/providers/matte-qualification-identity.js');
  globalThis.VS.MatteQualificationIdentity = Identity;
  globalThis.VS.MatteEnginesOriginal = class OriginalProvider {};
  require('../../js/providers/ppmatting-provider.js');
  require('../../js/providers/band-refine-core.js');
  require('../../js/providers/matte-critic.js');
  const { GenesisHybridProvider } = require('../../js/providers/hybrid-provider.js');

  const pp = new globalThis.VS.PPMattingV2Provider();
  Object.assign(pp, {
    _ready: true,
    _qualificationModelSha256: 'a'.repeat(64),
    _qualificationModelEntry: { title: 'PP-MattingV2' },
    _qualificationRegistryVersion: 2,
    _qualificationRuntime: { gpuRequested: false, backend: 'wasm', threads: 1 },
    longEdge: 384,
    useRoi: false,
    lowLightBoost: false,
    guard: null,
    initNote: ''
  });
  const ppIdentity = await pp.getQualificationIdentity();
  assert.strictEqual(Identity.validHash(ppIdentity.modelSha256), true);
  assert.strictEqual(Identity.validHash(ppIdentity.preprocessHash), true);
  assert.strictEqual(Identity.validHash(ppIdentity.postprocessHash), true);
  assert.match(ppIdentity.runtimeBackend, /backend=wasm/);

  const hybrid = new GenesisHybridProvider();
  Object.assign(hybrid, {
    _ready: true,
    _qualificationModelSha256: 'a'.repeat(64),
    _qualificationModelEntry: { title: 'PP-MattingV2' },
    _qualificationRegistryVersion: 2,
    _qualificationRuntime: { gpuRequested: false, backend: 'wasm', threads: 1 },
    longEdge: 384,
    useRoi: false,
    lowLightBoost: false,
    guard: null,
    initNote: ''
  });
  const hybridIdentity = await hybrid.getQualificationIdentity();
  assert.match(hybridIdentity.modelVersion, /genesis-hybrid-v1/);
  assert.notStrictEqual(hybridIdentity.preprocessHash, ppIdentity.preprocessHash);
  assert.notStrictEqual(hybridIdentity.postprocessHash, ppIdentity.postprocessHash);

  // Exercise the EdgeTAM proxy using a CPU-only mock ORT session. The identity
  // must include the selected fp32 checkpoint bytes and its encoder/decoder route.
  globalThis.ort = {
    InferenceSession: {
      create: async () => ({ release() {} })
    }
  };
  globalThis.VS.loadOrt = async () => {};
  globalThis.VS.ModelStore = {
    load: async (id) => ({
      bytes: {
        'encoder.onnx': new Uint8Array([1, 3, 5, 7]),
        'encoder.data': new Uint8Array([2, 4, 6, 8]),
        'decoder.onnx': new Uint8Array([9, 8, 7, 6]),
        'decoder.data': new Uint8Array([5, 4, 3, 2])
      },
      entry: {
        title: id,
        encoder: 'encoder.onnx',
        decoder: 'decoder.onnx',
        external: {
          'vision_encoder.onnx_data': 'encoder.data',
          'prompt_encoder_mask_decoder.onnx_data': 'decoder.data'
        }
      },
      registryVersion: 2
    })
  };
  const EdgeTAMGate = require('../../js/providers/edgetam-provider.js');
  const base = {
    label: 'Genesis Hybrid',
    initialize: async () => true,
    segment: async () => ({ segmentationMask: null }),
    dispose() {},
    getQualificationIdentity: async () => hybridIdentity,
    setTrackerHook() {}
  };
  const ultra = EdgeTAMGate.create(base);
  await ultra.initialize();
  assert.strictEqual(ultra.edgetam.status, 'ready');
  const ultraIdentity = await ultra.getQualificationIdentity();
  assert.match(ultraIdentity.modelVersion, /edgetam-fp32/);
  assert.match(ultraIdentity.runtimeBackend, /encoder-wasm\+decoder-wasm/);
  assert.notStrictEqual(ultraIdentity.modelSha256, hybridIdentity.modelSha256);
  assert.notStrictEqual(ultraIdentity.preprocessHash, hybridIdentity.preprocessHash);
  assert.notStrictEqual(ultraIdentity.postprocessHash, hybridIdentity.postprocessHash);

  console.log('matte-provider-qualification-identity: PP-Matting, Hybrid and EdgeTAM assertions passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
