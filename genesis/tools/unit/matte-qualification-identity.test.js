'use strict';
const assert = require('assert');
const { webcrypto } = require('crypto');
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
}

const Identity = require('../../js/providers/matte-qualification-identity.js');
const originalFetch = globalThis.fetch;
const sources = {
  'pre-v1.js': 'export function preprocess(frame) { return frame; }',
  'pre-v2.js': 'export function preprocess(frame) { return normalize(frame); }',
  'post-v1.js': 'export function refine(alpha) { return alpha; }',
  'post-v2.js': 'export function refine(alpha) { return feather(alpha); }',
  'ort-wasm.js': 'onnxruntime-wasm-bundle-v1',
  'ort-edge.js': 'onnxruntime-edgetam-bundle-v1'
};

globalThis.fetch = async (path) => {
  const source = sources[String(path)];
  if (source == null) return { ok: false, status: 404 };
  const bytes = new TextEncoder().encode(source);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
};

(async () => {
  try {
    const modelFilesA = {
      'weights-b.onnx': new Uint8Array([4, 5, 6]),
      'weights-a.onnx': new Uint8Array([1, 2, 3])
    };
    const modelFilesB = {
      'weights-a.onnx': new Uint8Array([1, 2, 3]),
      'weights-b.onnx': new Uint8Array([4, 5, 6])
    };
    const baseOptions = {
      modelVersion: 'ppmatting-v2@registry-2',
      modelFiles: modelFilesA,
      preprocessResources: ['pre-v1.js'],
      preprocessConfig: { input: 'RGB-NCHW', longEdge: 512 },
      postprocessResources: ['post-v1.js'],
      postprocessConfig: { temporal: 'refined', guard: true },
      runtime: { name: 'onnxruntime-web', backend: 'wasm', resources: ['ort-wasm.js'], config: { threads: 2 } }
    };

    const first = await Identity.create(baseOptions);
    const reordered = await Identity.create(Object.assign({}, baseOptions, { modelFiles: modelFilesB }));
    assert.deepStrictEqual(reordered, first, 'model asset map ordering must not change the canonical identity');
    assert.strictEqual(Identity.validHash(first.modelSha256), true);
    assert.strictEqual(Identity.validHash(first.preprocessHash), true);
    assert.strictEqual(Identity.validHash(first.postprocessHash), true);
    assert.match(first.runtimeBackend, /backend=wasm/);

    const changedWeights = await Identity.create(Object.assign({}, baseOptions, {
      modelFiles: { 'weights-a.onnx': new Uint8Array([1, 2, 9]), 'weights-b.onnx': new Uint8Array([4, 5, 6]) }
    }));
    assert.notStrictEqual(changedWeights.modelSha256, first.modelSha256, 'changed model bytes must invalidate identity');

    const changedPreprocess = await Identity.create(Object.assign({}, baseOptions, {
      preprocessResources: ['pre-v2.js']
    }));
    assert.notStrictEqual(changedPreprocess.preprocessHash, first.preprocessHash, 'changed preprocessing source must invalidate identity');

    const changedPostprocess = await Identity.create(Object.assign({}, baseOptions, {
      postprocessResources: ['post-v2.js']
    }));
    assert.notStrictEqual(changedPostprocess.postprocessHash, first.postprocessHash, 'changed postprocessing source must invalidate identity');

    const changedRuntime = await Identity.create(Object.assign({}, baseOptions, {
      runtime: { name: 'onnxruntime-web', backend: 'webgpu', resources: ['ort-wasm.js'], config: { threads: 2 } }
    }));
    assert.notStrictEqual(changedRuntime.runtimeBackend, first.runtimeBackend, 'changed backend must invalidate runtime identity');

    const edgeModelHash = await Identity.hashModelFiles({ 'edge-encoder.onnx': new Uint8Array([7, 8, 9]) });
    const composed = await Identity.extend(first, {
      modelVersionSuffix: '+edgetam-fp16',
      modelSha256: edgeModelHash,
      preprocessResources: ['pre-v2.js'],
      preprocessConfig: { encoderSide: 1024 },
      postprocessResources: ['post-v2.js'],
      postprocessConfig: { refreshEvery: 8 },
      runtime: { name: 'onnxruntime-web-edgetam', backend: 'encoder-webgpu+decoder-wasm', resources: ['ort-edge.js'], config: { encoder: 'fp16' } }
    });
    assert.match(composed.modelVersion, /edgetam-fp16/);
    assert.notStrictEqual(composed.modelSha256, first.modelSha256, 'composed pipeline identity must include EdgeTAM weights');
    assert.notStrictEqual(composed.preprocessHash, first.preprocessHash, 'composed pipeline identity must include EdgeTAM preprocessing');
    assert.notStrictEqual(composed.postprocessHash, first.postprocessHash, 'composed pipeline identity must include EdgeTAM postprocessing');
    assert.match(composed.runtimeBackend, /encoder-webgpu\+decoder-wasm/);

    await assert.rejects(
      Identity.create(Object.assign({}, baseOptions, { modelSha256: 'not-a-sha256' })),
      /Exact model asset SHA-256 is unavailable/
    );
    await assert.rejects(
      Identity.create(Object.assign({}, baseOptions, { preprocessResources: ['missing.js'] })),
      /Could not read pipeline identity resource/
    );

    console.log('matte-qualification-identity: all assertions passed');
  } finally {
    globalThis.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
