/* Frame-identity gate for asynchronous segmentation results.
 *
 * Every inference is started with a ticket that records WHICH camera session,
 * provider, cache epoch, source geometry and sequence number it was run for.
 * When the (possibly late) result arrives it is accepted only if all of those
 * still match the present state and no newer result has already been accepted.
 * A rejected result is dropped with a reason code instead of overwriting a
 * valid, newer matte. Pure logic: no DOM, no timers. */
(function (root) {
  'use strict';
  const VS = root.VS = root.VS || {};

  function create() {
    let epoch = 0, seq = 0, lastAcceptedSeq = 0;
    const rejected = Object.create(null);
    let lastBumpReason = 'init';

    function geometry(g) {
      return g ? (Number(g.width) || 0) + 'x' + (Number(g.height) || 0) + '@' + (g.orientation == null ? '' : g.orientation) : '';
    }

    return {
      /* Invalidate every outstanding ticket (engine switch, camera restart,
       * resolution/orientation change, cache reset, scene cut). */
      bump(reason) { epoch++; lastBumpReason = String(reason || 'reset'); return epoch; },
      begin(state) {
        state = state || {};
        return {
          epoch, seq: ++seq, loopToken: state.loopToken, provider: state.provider || null,
          geometry: geometry(state.geometry), startedAt: state.now == null ? 0 : state.now
        };
      },
      /* Returns { ok:true } or { ok:false, reason }. Accepting records the
       * ticket so an older sequence number can never overwrite it later. */
      accept(ticket, state) {
        state = state || {};
        let reason = null;
        if (!ticket) reason = 'no-ticket';
        else if (ticket.epoch !== epoch) reason = 'superseded-epoch:' + lastBumpReason;
        else if (ticket.loopToken !== state.loopToken) reason = 'camera-session-changed';
        else if (ticket.provider !== (state.provider || null)) reason = 'provider-changed';
        else if (ticket.geometry !== geometry(state.geometry)) reason = 'source-geometry-changed';
        else if (ticket.seq <= lastAcceptedSeq) reason = 'older-than-accepted';
        if (reason) { const k = reason.split(':')[0]; rejected[k] = (rejected[k] || 0) + 1; return { ok: false, reason }; }
        lastAcceptedSeq = ticket.seq;
        return { ok: true };
      },
      stats() { return { epoch, issued: seq, lastAcceptedSeq, rejected: Object.assign({}, rejected) }; }
    };
  }

  const api = { create };
  VS.FrameEpoch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
