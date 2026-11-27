'use strict';
global.window = globalThis;
globalThis.VS = globalThis.VS || {};

const assert = require('assert');
const Provider = require('../../js/providers/modnet-provider.js');
const Flight = require('../../js/providers/segmentation-flight.js').create();

(async () => {
  const provider = new globalThis.VS.MODNetWorkerProvider();
  let terminated = false, released = false;
  provider._worker = {
    postMessage() {},
    terminate() { terminated = true; }
  };
  provider._ready = true;

  const frame = { id: 1 };
  const inference = Flight.run(provider, frame, () => provider._send({ type: 'run' }));
  Flight.releaseFrame(frame, () => { released = true; });

  assert.strictEqual(Flight.isBusy(provider), true, 'in-flight worker request owns the provider lock');
  assert.strictEqual(released, false, 'source frame remains leased while worker inference is pending');
  assert.strictEqual(provider._pending.size, 1, 'worker request is tracked before disposal');

  provider.dispose();
  await assert.rejects(inference, (error) => error.code === 'PROVIDER_DISPOSED',
    'disposing a worker must reject its outstanding request');
  await Promise.resolve();

  assert.strictEqual(provider._pending.size, 0, 'disposal clears the pending request map');
  assert.strictEqual(provider._worker, null, 'disposed worker reference is cleared');
  assert.strictEqual(provider._ready, false, 'disposed provider is no longer ready');
  assert.strictEqual(terminated, true, 'worker is terminated');
  assert.strictEqual(Flight.isBusy(provider), false, 'rejected request releases the segmentation-flight lock');
  assert.strictEqual(released, true, 'settled request releases its deferred frame lease');

  provider.dispose();
  console.log('modnet-worker-lifecycle: pending inference rejects and releases all ownership');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
