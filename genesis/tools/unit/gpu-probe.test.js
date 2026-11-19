const assert = require('assert'), P = require('../../js/providers/gpu-probe.js');
const store = (v) => ({ getItem: () => v });
(async () => {
  let r = await P.run({}, store(null)); assert.strictEqual(r.ok, false); assert.ok(r.lines.some((l) => /no WebGPU/.test(l)));
  r = await P.run({ gpu: { requestAdapter: async () => null } }, store('1')); assert.strictEqual(r.ok, false); assert.ok(r.lines.some((l) => /no WebGPU adapter/.test(l))); assert.ok(r.lines.some((l) => l === 'vs_webgpu flag: 1'));
  r = await P.run({ gpu: { requestAdapter: async () => { throw new Error('blocked'); } } }, store(null)); assert.ok(r.lines.some((l) => /requestAdapter threw: blocked/.test(l)));
  const adapter = (devErr) => ({ info: { vendor: 'arm', architecture: 'valhall', device: '', description: 'Mali-G52' }, features: new Set(['shader-f16']), limits: { maxBufferSize: 268435456 }, requestDevice: async () => { if (devErr) throw new Error(devErr); return { destroy() {} }; } });
  r = await P.run({ gpu: { requestAdapter: async () => adapter() } }, store('1')); assert.strictEqual(r.ok, true); assert.strictEqual(r.adapter.vendor, 'arm'); assert.ok(r.lines.some((l) => /Mali-G52/.test(l))); assert.ok(r.lines.some((l) => /shader-f16/.test(l))); assert.ok(r.lines.some((l) => /maxBufferSize=268435456/.test(l)));
  r = await P.run({ gpu: { requestAdapter: async () => adapter('device lost at start') } }, store('1')); assert.strictEqual(r.ok, false); assert.ok(r.lines.some((l) => /requestDevice FAILED: device lost at start/.test(l)));
  r = await P.run({ gpu: { requestAdapter: async () => ({ isFallbackAdapter: true, features: [], limits: {}, requestDevice: async () => ({}) }) } }, { getItem() { throw new Error('x'); } }); assert.ok(r.lines.some((l) => /software fallback/.test(l))); assert.ok(r.lines.some((l) => /unreadable/.test(l)));
  console.log('gpu-probe: all assertions passed');
})();
