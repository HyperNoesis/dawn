'use strict';
const assert = require('assert');

global.window = global;
global.VS = {};
global.document = {};
require('../../js/providers/modnet-provider.js');

const WorkerProvider = global.VS.MODNetWorkerProvider;
assert.ok(WorkerProvider, 'worker provider is exported for the browser runtime');

(async () => {
  let terminated = false;
  const provider = Object.create(WorkerProvider.prototype);
  Object.assign(provider, {
    _seq: 0,
    _pending: new Map(),
    _ready: true,
    _worker: {
      postMessage() { /* deliberately never replies */ },
      terminate() { terminated = true; }
    }
  });

  const first = provider._send({ type: 'run' }, [], 25);
  const second = provider._send({ type: 'profile-get' }, [], 1000);
  const settled = await Promise.allSettled([first, second]);
  assert.strictEqual(settled[0].status, 'rejected');
  assert.strictEqual(settled[0].reason.code, 'WORKER_REQUEST_TIMEOUT');
  assert.strictEqual(settled[1].status, 'rejected', 'terminating a hung worker settles every queued request');
  assert.strictEqual(settled[1].reason.code, 'WORKER_REQUEST_TIMEOUT');
  assert.strictEqual(terminated, true, 'a non-responsive worker is terminated');
  assert.strictEqual(provider._ready, false, 'a timed-out worker cannot be reused');
  assert.strictEqual(provider._worker, null);
  assert.strictEqual(provider._pending.size, 0, 'no pending worker promises remain');

  let successTerminated = false;
  const success = Object.create(WorkerProvider.prototype);
  Object.assign(success, {
    _seq: 0,
    _pending: new Map(),
    _ready: true,
    _worker: {
      postMessage(message) {
        setTimeout(() => success._worker.onmessage({ data: { id: message.id, type: 'result', value: 7 } }), 5);
      },
      terminate() { successTerminated = true; }
    }
  });
  const result = await success._send({ type: 'run' }, [], 100);
  assert.strictEqual(result.value, 7);
  assert.strictEqual(success._pending.size, 0);
  assert.strictEqual(successTerminated, false, 'a healthy reply clears its timeout without terminating the worker');

  console.log('modnet-worker-request-timeout: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
