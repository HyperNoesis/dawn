// v0.90 remote switches: a risky feature can be turned DOWN for everyone by editing flags.json (one small push, no user action).
// Safety rules: only known keys are read, values are clamped to a safe range, a missing/slow/broken file changes nothing, and nothing
// is sent anywhere (it only reads ./flags.json from the same site). A user's own localStorage override always wins over the file.
(function (root) {
  'use strict';
  const VS = root.VS = root.VS || {};
  const DEFAULTS = { colourSnap: 0.8, ppmattingBeta: 1, promotePPMatting: 0, ultraDefault: 1 };   // v1.01 ultraDefault: 1 = Genesis UltraMatte is the default engine and the governor never leaves it (only the picture size steps down); 0 = old Automatic behaviour (kill switch)
  //   // v0.89 colour-line edge correction strength (0 = off); v0.94 ppmattingBeta: show the PP-MattingV2 beta engine in the picker (1) or hide it for everyone (0); promotePPMatting: 1 lets a PASSING release gate make it the default (stays 0)
  const LIMITS = { colourSnap: [0, 1], ppmattingBeta: [0, 1], promotePPMatting: [0, 1], ultraDefault: [0, 1] };

  /** Keep only known keys with finite numbers inside their limits. Anything else is ignored (never throws). */
  function sanitize(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const k of Object.keys(DEFAULTS)) {
      const v = raw[k];
      if (typeof v !== 'number' || !isFinite(v)) continue;
      const lim = LIMITS[k]; out[k] = Math.min(lim[1], Math.max(lim[0], v));
    }
    return out;
  }

  let current = Object.assign({}, DEFAULTS);
  function get(k) { return current[k]; }
  function apply(raw) { current = Object.assign({}, DEFAULTS, sanitize(raw)); return current; }

  /** Fetch flags.json (no-store, short timeout). Always resolves; on any problem the defaults stay. */
  function load(fetchFn, timeoutMs) {
    const f = fetchFn || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    if (!f) return Promise.resolve(current);
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs || 2500) : null;
    return f('flags.json', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then((r) => (r && r.ok ? r.json() : null))
      .then((j) => { if (j) apply(j); return current; })
      .catch(() => current)
      .then((c) => { if (timer) clearTimeout(timer); return c; });
  }

  VS.Flags = { DEFAULTS, sanitize, get, apply, load, ready: Promise.resolve(current) };
  if (typeof document !== 'undefined' && typeof root.fetch === 'function') VS.Flags.ready = load();
})(typeof self !== 'undefined' ? self : this);
