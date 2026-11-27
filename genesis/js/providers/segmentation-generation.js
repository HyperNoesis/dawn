/* Pure guard for segmentation work that may outlive a camera/provider generation.
 * It deliberately compares object identity as well as monotonic session/provider
 * counters; matching frame numbers from a different provider are not sufficient.
 */
(function (root) {
  'use strict';

  function stamp(provider, sessionToken, providerGeneration) {
    return Object.freeze({ provider, sessionToken, providerGeneration });
  }

  function matches(job, current) {
    return !!job && !!current &&
      job.provider === current.provider &&
      job.sessionToken === current.sessionToken &&
      job.providerGeneration === current.providerGeneration;
  }

  const api = { stamp, matches };
  root.VS = root.VS || {};
  root.VS.SegmentationGeneration = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
