const assert = require('assert');
const { create } = require('../../js/providers/segmentation-flight.js');

function shrink(frame) { frame.width = 1; frame.height = 1; }

(async () => {
  const flight = create();
  const provider = {};
  const frame = { width: 640, height: 480 };
  let finishFirst, releases = 0;

  const first = flight.run(provider, frame, () => new Promise((resolve) => { finishFirst = resolve; }));
  await Promise.resolve();
  assert.strictEqual(flight.isBusy(provider), true, 'provider is marked busy while its real task is pending');
  assert.strictEqual(flight.releaseFrame(frame, (f) => { shrink(f); releases++; }), false,
    'a requested release is deferred while inference still reads the frame');
  assert.deepStrictEqual([frame.width, frame.height], [640, 480], 'the live snapshot is not mutated on watchdog timeout');

  let duplicateTaskRan = false;
  const duplicate = flight.run(provider, { width: 10, height: 10 }, () => { duplicateTaskRan = true; });
  await assert.rejects(duplicate, (error) => error.code === 'SEGMENTATION_BUSY');
  assert.strictEqual(duplicateTaskRan, false, 'a second inference cannot overlap the quarantined provider');
  assert.strictEqual(flight.isBusy(provider), true);

  finishFirst('completed');
  assert.strictEqual(await first, 'completed');
  assert.deepStrictEqual([frame.width, frame.height], [1, 1], 'the requested release runs as soon as inference settles');
  assert.strictEqual(releases, 1);
  assert.strictEqual(flight.isBusy(provider), false, 'settled provider is unlocked');

  const failedFrame = { width: 320, height: 240 };
  const failure = new Error('worker failed');
  const failedRun = flight.run(provider, failedFrame, () => Promise.reject(failure));
  flight.releaseFrame(failedFrame, shrink);
  await assert.rejects(failedRun, (error) => error === failure);
  assert.deepStrictEqual([failedFrame.width, failedFrame.height], [1, 1],
    'the rejected-task path also releases its deferred source snapshot');

  // A frame shared by separate providers is only released after both readers settle.
  const shared = { width: 800, height: 600 };
  let finishA, finishB;
  const a = flight.run({}, shared, () => new Promise((resolve) => { finishA = resolve; }));
  const b = flight.run({}, shared, () => new Promise((resolve) => { finishB = resolve; }));
  await Promise.resolve();
  flight.releaseFrame(shared, shrink);
  finishA('a'); await a;
  assert.deepStrictEqual([shared.width, shared.height], [800, 600], 'one remaining reader keeps the shared frame alive');
  finishB('b'); await b;
  assert.deepStrictEqual([shared.width, shared.height], [1, 1], 'the last reader releases a shared frame exactly once');

  console.log('segmentation-flight: all assertions passed');
})().catch((error) => { console.error(error); process.exit(1); });
