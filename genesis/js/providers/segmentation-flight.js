/* Per-provider inference serialization and deferred source-frame release. */
(function (root) {
  'use strict';
  const VS = root.VS = root.VS || {};

  function isObject(value) {
    return value !== null && (typeof value === 'object' || typeof value === 'function');
  }

  function create() {
    const providers = new WeakMap();
    const frames = new WeakMap();

    function finish(record) {
      if (record.settled) return;
      record.settled = true;
      if (providers.get(record.provider) === record) providers.delete(record.provider);

      const lease = record.frameLease;
      if (!lease) return;
      lease.count = Math.max(0, lease.count - 1);
      if (lease.count === 0 && frames.get(record.frame) === lease) {
        frames.delete(record.frame);
        if (lease.releaseRequested && typeof lease.release === 'function') {
          try { lease.release(record.frame); } catch (e) { /* release is best-effort */ }
        }
      }
    }

    function run(provider, frame, task) {
      if (!isObject(provider) || typeof task !== 'function') {
        return Promise.reject(new TypeError('SegmentationFlight requires a provider and task'));
      }
      const active = providers.get(provider);
      if (active && !active.settled) {
        const error = new Error('Previous segmentation inference is still running for this provider');
        error.code = 'SEGMENTATION_BUSY';
        return Promise.reject(error);
      }

      const record = { provider, frame, settled: false, frameLease: null };
      providers.set(provider, record);
      if (isObject(frame)) {
        let lease = frames.get(frame);
        if (!lease) {
          lease = { count: 0, releaseRequested: false, release: null };
          frames.set(frame, lease);
        }
        lease.count++;
        record.frameLease = lease;
      }

      let result;
      try { result = task(); }
      catch (error) { result = Promise.reject(error); }
      const promise = Promise.resolve(result).then(
        (value) => { finish(record); return value; },
        (error) => { finish(record); throw error; }
      );
      promise.catch(() => {});
      return promise;
    }

    function releaseFrame(frame, release) {
      if (!isObject(frame) || typeof release !== 'function') return false;
      const lease = frames.get(frame);
      if (lease && lease.count > 0) {
        lease.releaseRequested = true;
        if (!lease.release) lease.release = release;
        return false;
      }
      try { release(frame); } catch (e) { /* release is best-effort */ }
      return true;
    }

    function isBusy(provider) {
      const active = isObject(provider) ? providers.get(provider) : null;
      return !!(active && !active.settled);
    }

    return { run, releaseFrame, isBusy };
  }

  const api = { create };
  VS.SegmentationFlight = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
