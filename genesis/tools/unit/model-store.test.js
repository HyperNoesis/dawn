// Runs ModelStore against real files on disk through a stubbed fetch. Set GENESIS_MODELS_DIR to a folder holding the edgetam files.
const assert = require('assert'), fs = require('fs'), path = require('path');
const dir = process.env.GENESIS_MODELS_DIR;
if (!dir || !fs.existsSync(path.join(dir, 'edgetam_mask_decoder.onnx'))) { console.log('model-store: SKIPPED (set GENESIS_MODELS_DIR to a folder containing the edgetam files)'); process.exit(0); }
const regPath = path.join(__dirname, '..', '..', 'models', 'registry.json');
let corrupt = false;
globalThis.fetch = async (url) => {
  const mk = (buf, type) => new Response(buf, { status: 200, headers: { 'content-type': type || 'application/octet-stream' } });
  if (url === 'models/registry.json') return mk(fs.readFileSync(regPath), 'application/json');
  if (url.startsWith('models/')) {
    const f = path.join(dir, url.slice(7)); if (!fs.existsSync(f)) return new Response('nope', { status: 404 });
    const b = Buffer.from(fs.readFileSync(f)); if (corrupt && f.endsWith('mask_decoder.onnx')) b[10] ^= 0xff; return mk(b);
  }
  return new Response('blocked by CORS in browsers', { status: 404 });
};
const S = require('../../js/providers/model-store.js');
(async () => {
  const seen = [];
  const r = await S.load('edgetam', { onProgress: (f) => seen.push(f) });
  assert.deepStrictEqual(Object.keys(r.bytes).sort(), ['edgetam_mask_decoder.onnx', 'edgetam_mask_decoder.onnx_data', 'edgetam_vision_encoder_fp16.onnx', 'edgetam_vision_encoder_fp16.onnx_data']);
  assert.strictEqual(r.bytes['edgetam_vision_encoder_fp16.onnx_data'].length, 9739536);
  console.log('progress samples', seen.length, seen.slice(-2));
  assert.ok(seen.length >= 4 && Math.abs(seen[seen.length - 1] - 1) < 1e-9 && seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'monotonic progress ending at 1');
  corrupt = true;
  await assert.rejects(() => S.load('edgetam'), /Checksum mismatch|HTTP 404/, 'corrupted file must be rejected');
  await assert.rejects(() => S.load('nope'), /Unknown model/);
  console.log('model-store: all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
