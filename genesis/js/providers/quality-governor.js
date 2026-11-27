/**
 * QualityGovernor (v0.96): ONE place that decides how much matting quality a device can hold right now, and moves it in SMALL, REVERSIBLE steps.
 * PURE (no DOM, no timers, time comes in with each sample), so whole sessions are simulated in tools/unit/quality-governor.test.js.
 *
 * Why it exists. The v0.50-v0.95 ladder had three hard edges: (1) a "hopeless" rule jumped to the blocky light model after ~2 s of slow masks, so a
 * thermal blip or a warm-up cost the whole session its good cut-out; (2) once on the light model the session could only climb back twice; (3) while
 * recording the ladder refused to act, so a slow phone stayed in a slideshow. This governor replaces those rules.
 *
 * Arrangement (best quality first). A CHAIN of matting engines, each with fine size steps (64 px), then the light model as an EMERGENCY rung only:
 *     UltraMatte 512 > 448 > 384 > 320
 *       > Hybrid 320 > PP-MattingV2 320 > MODNet 512 > 448 > 384 > 320 > 256 > 224
 *       > (emergency) MediaPipe
 * The caller supplies the chain for the active route. Engine boundaries are
 * crossed only after the current route's resolution ladder is exhausted.
 *
 * Rules.
 *  - Pressure must be SUSTAINED and judged on a window (>= 85 % of the ticks bad), never on one slow second; the first SETTLE_MS after any change is ignored (warm-up).
 *  - A step down moves to the best rung PREDICTED to fit (cost ~ edge^2 + fixed part), measured, not guessed; usually that is one rung, a far-too-slow device lands near the right size at once
 *    instead of crawling down through a slideshow. The prediction is then verified by the next window.
 *  - Crossing from one engine to the next only happens at the end of an engine's sizes, and only to a rung predicted cheaper. Not while recording (except a stall).
 *  - EMERGENCY (light model) needs: already at the smallest matting rung AND the mask still >= HOPELESS_MS for HOPELESS_SEC in a row. Never from a single slow second.
 *  - Recovery: unlimited, one rung at a time, after UP_SEC of real headroom (predicted to fit with margin). Each failed probe (back down within PROBE_FAIL_MS) doubles the wait (max x16).
 *    From the emergency rung it probes back to the smallest matting rung, same backoff.
 *  - A STALL (one inference that never returned) is not "slow": the caller restarts the engine one rung lower (fresh worker); 3 stalls in 60 s -> emergency.
 *  - Camera-bound (output ~= camera rate, mask much faster than a camera frame) never counts as pressure.
 */
(function (root) {
  const VS = root.VS = root.VS || {};
  const C = {
    FLOOR_FPS: 18, TARGET_FPS: 24, UP_FPS: 27, CAM_BOUND_SHARE: 0.85,
    DOWN_SEC: 6, DOWN_SEC_CAM: 8,            // window length before a step down (camera rate known = judge more patiently)
    BAD_SHARE: 0.85,                         // share of window ticks that must be bad
    SETTLE_MS: 5000,                         // ignore pressure for this long after any change (model warm-up / re-jit)
    FIRST_SETTLE_MS: 3000,                   // ...but only this long at session start (the engine was already warmed up before the first frame)
    SEVERE_FPS: 5, SEVERE_TICKS: 4,          // a slideshow (< 5 fps) needs no 8 s verdict: 4 bad ticks in a row is enough to CHANGE SIZE (never the engine or the light model)
    MIN_DWELL_MS: 8000,                      // minimum time between two downward moves
    UP_SEC: 20, UP_BACKOFF_MAX: 16, PROBE_FAIL_MS: 45000,
    HOPELESS_MS: 700, HOPELESS_SEC: 10,
    NOGAIN_SEC: 20, NOGAIN_GAIN: 1.3, NOGAIN_HOLD_MS: 600000,   // emergency that did not help (the frame is slow for a reason other than the mask): return to matting, do not go light again for 10 min
    SLIDESHOW_FPS: 8, SLIDESHOW_SEC: 15,     // found by the live heat emulation: at the smallest size the mask can be 300-400 ms (< HOPELESS_MS) = a permanent 3-5 fps slideshow. Model-bound and < SLIDESHOW_FPS for SLIDESHOW_SEC at the floor -> light model (probes back up with back-off).
    STALL_RESTARTS_TO_EMERGENCY: 3, STALL_WINDOW_MS: 60000,
    FIXED_SHARE: 0.15,                       // share of a mask's time that does not shrink with the picture size
    MIN_UP_MARGIN: 0.8,                      // predicted mask time must be <= this share of a frame interval to climb
  };
  const DEFAULT_CHAIN = [
    { engine: 'modnet', edges: [512, 448, 384, 320, 256, 224] },
  ];

  /** Flatten a chain into quality-ordered rungs. startEdges lets the caller add the size a provider really runs at. */
  function buildRungs(chain, startEngine, startEdge) {
    const rungs = [];
    (chain && chain.length ? chain : DEFAULT_CHAIN).forEach((c) => {
      const edges = c.edges.slice();
      if (c.engine === startEngine && startEdge > 0 && edges.indexOf(startEdge) < 0) edges.push(startEdge);
      edges.sort((a, b) => b - a);
      edges.forEach((e) => rungs.push({ engine: c.engine, edge: e, emergency: false }));
    });
    return rungs;
  }

  function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[(s.length - 1) >> 1]; }

  function create(cfg) {
    cfg = cfg || {};
    const K = Object.assign({}, C, cfg.constants || {});
    const lockPre = cfg.lockEngine !== undefined ? !!cfg.lockEngine : (!!VS.Flags && VS.Flags.get('ultraDefault') === 1 && cfg.startEngine === 'genesis-hybrid-tam');
    const emergencyEngine = lockPre ? null : (cfg.emergency === undefined ? 'mediapipe' : cfg.emergency);   // null = never fall to the light model
    // v1.01 lock: when the flag is on (or cfg.lockEngine) and UltraMatte is running, the chain keeps ONLY UltraMatte's own size steps and there is no emergency rung.
    // Under load the picture size comes down (512 > 320), the engine never changes, so the cut-out never turns into a blob or the light model.
    const lockOn = cfg.lockEngine !== undefined ? !!cfg.lockEngine : (!!VS.Flags && VS.Flags.get('ultraDefault') === 1 && cfg.startEngine === 'genesis-hybrid-tam');
    let chainIn = cfg.chain;
    if (lockOn && cfg.startEngine && chainIn && chainIn.length) { const only = chainIn.filter((c) => c.engine === cfg.startEngine); if (only.length) chainIn = only; }
    let rungs = buildRungs(chainIn, cfg.startEngine, cfg.startEdge);
    const emergencyRung = emergencyEngine ? { engine: emergencyEngine, edge: 0, emergency: true } : null;
    const eng0 = cfg.startEngine || rungs[0].engine;
    let cur = rungs.findIndex((r) => r.engine === eng0 && r.edge === cfg.startEdge);
    if (cur < 0) cur = Math.max(0, rungs.findIndex((r) => r.engine === eng0));
    let inEmergency = false;
    const cost = Object.assign({}, cfg.costFactor || {});   // ms per (edge^2 / 1e4), learned per engine from measurements
    const hist = [];                                         // recent ticks {t, bad, fps, segMs}
    let lastChangeAt = (cfg.now || 0) - (K.SETTLE_MS - K.FIRST_SETTLE_MS), lastDownAt = -1e9, lastUpAt = -1e9, upWait = K.UP_SEC, upBackoff = 1;
    let noGainUntil = 0, emFps = 0, pendingFps = 0, lastFps = 0, goodSince = null, slideSince = null, hopelessSince = null, stalls = [];
    let pendingProbe = false;

    const rungOf = () => (inEmergency ? emergencyRung : rungs[cur]);
    function predictMs(rung, fromRung, fromMs) {
      if (!rung || rung.emergency) return 0;
      const unit = (r) => (r.edge * r.edge) / 1e4;
      const kTo = cost[rung.engine], kFrom = fromRung && !fromRung.emergency ? cost[fromRung.engine] : undefined;
      if (fromRung && !fromRung.emergency && fromMs > 0) {
        const fixed = fromMs * K.FIXED_SHARE, var0 = fromMs - fixed;
        const scale = (kTo && kFrom) ? kTo / kFrom : 1;           // engines compare through their learned speed ratio; unknown = same
        return fixed + var0 * (unit(rung) / unit(fromRung)) * scale;
      }
      return kTo ? kTo * unit(rung) : 0;
    }
    function learn(sample) {
      const r = rungOf(); if (!r || r.emergency || !(sample.segMs > 0)) return;
      const k = sample.segMs / ((r.edge * r.edge) / 1e4);
      cost[r.engine] = cost[r.engine] ? cost[r.engine] * 0.8 + k * 0.2 : k;
    }

    function hold(reason) { return { type: 'hold', reason: reason || '' }; }
    function move(kind, rung, idx, why, t) { return { type: kind, engine: rung.engine, edge: rung.edge, rungIndex: idx, emergency: !!rung.emergency, why }; }

    /** One tick per second. sample: {t, fps, camFps, segMs, busy, stalls (count since last tick)} */
    function tick(s) {
      const t = s.t; lastFps = s.fps;
      learn(s);
      // ---- stalls: act at once (a hung inference is not a slow one) ----
      if (s.stalls > 0) { for (let i = 0; i < s.stalls; i++) stalls.push(t); }
      stalls = stalls.filter((x) => t - x <= K.STALL_WINDOW_MS);
      if (s.stalls > 0) {
        if (!inEmergency && stalls.length >= K.STALL_RESTARTS_TO_EMERGENCY && emergencyRung) return move('emergency', emergencyRung, -1, 'repeated stalls', t);
        if (inEmergency) return move('restart', emergencyRung, -1, 'stall', t);
        const to = Math.min(rungs.length - 1, cur + 1);
        const nx = rungs[to];
        return move('restart', nx, to, 'stall', t);
      }
      // ---- classify this tick ----
      const cam = s.camFps > 0 ? s.camFps : 0;
      const floor = cam ? Math.min(K.FLOOR_FPS, cam * K.CAM_BOUND_SHARE) : K.FLOOR_FPS;
      const frameMs = 1000 / (cam ? Math.min(30, cam) : K.TARGET_FPS);
      let modelBound = true;
      if (cam && s.fps >= cam * K.CAM_BOUND_SHARE) modelBound = false;
      else if (s.segMs > 0 && s.segMs < frameMs * 0.75) modelBound = false;
      if (!(s.fps > 0)) modelBound = s.segMs >= 150;
      const bad = (s.fps < floor || !(s.fps > 0)) && modelBound;
      hist.push({ t, bad, fps: s.fps, segMs: s.segMs }); while (hist.length > 30) hist.shift();
      if (t - lastChangeAt < K.SETTLE_MS) { goodSince = null; return hold('settling'); }
      const need = cam ? K.DOWN_SEC_CAM : K.DOWN_SEC;
      const win = hist.filter((h) => t - h.t < need * 1000 + 500 && h.t >= lastChangeAt + K.SETTLE_MS);
      const sev = hist.filter((h) => h.t >= lastChangeAt + K.SETTLE_MS).slice(-K.SEVERE_TICKS);
      const severe = sev.length >= K.SEVERE_TICKS && sev.every((h) => h.bad && h.fps < K.SEVERE_FPS);
      const useWin = severe ? sev : win;
      const windowFull = severe || win.length >= need;
      const badShare = useWin.length ? useWin.filter((h) => h.bad).length / useWin.length : 0;
      const segMed = median(useWin.map((h) => h.segMs).filter((x) => x > 0));

      // ---- emergency tracking: only at the smallest matting rung ----
      const atFloor = isFloor(s.segMs);
      if (atFloor && s.segMs >= K.HOPELESS_MS) hopelessSince = hopelessSince == null ? t : hopelessSince; else if (!inEmergency) hopelessSince = null;
      const slideshow = atFloor && modelBound && s.fps > 0 && s.fps < K.SLIDESHOW_FPS;
      if (slideshow) slideSince = slideSince == null ? t : slideSince; else slideSince = null;
      if (atFloor && emergencyRung && t >= noGainUntil && slideSince != null && t - slideSince >= K.SLIDESHOW_SEC * 1000) {
        if (t - lastUpAt < K.PROBE_FAIL_MS) upBackoff = Math.min(K.UP_BACKOFF_MAX, upBackoff * 2);
        slideSince = null;
        return commit('emergency', emergencyRung, -1, 'still only ' + Math.round(s.fps) + ' fps (mask ' + Math.round(s.segMs) + ' ms) at the smallest matting size for ' + K.SLIDESHOW_SEC + ' s', t, true);
      }
      if (atFloor && emergencyRung && t >= noGainUntil && hopelessSince != null && t - hopelessSince >= K.HOPELESS_SEC * 1000) {
        if (t - lastUpAt < K.PROBE_FAIL_MS) upBackoff = Math.min(K.UP_BACKOFF_MAX, upBackoff * 2);   // a probe back from the light model failed: wait longer next time
        return commit('emergency', emergencyRung, -1, 'mask still ' + Math.round(s.segMs) + ' ms at the smallest matting size for ' + K.HOPELESS_SEC + ' s', t, true);
      }

      // ---- an emergency that did not help: the light model changed nothing, so the matting model was not the bottleneck ----
      if (inEmergency && !pending && t - lastChangeAt >= K.NOGAIN_SEC * 1000) {
        const w2 = hist.filter((h) => h.t >= lastChangeAt + K.SETTLE_MS && h.fps > 0);
        if (w2.length >= 10 && emFps > 0) {
          const f2 = median(w2.map((h) => h.fps));
          if (f2 < emFps * K.NOGAIN_GAIN && f2 < K.FLOOR_FPS) {
            noGainUntil = t + K.NOGAIN_HOLD_MS; upBackoff = Math.min(K.UP_BACKOFF_MAX, upBackoff * 2);
            const to = lastMattingIdx();
            return commit('swap-engine', rungs[to], to, 'the light model gave no gain (' + Math.round(f2) + ' fps vs ' + Math.round(emFps) + ' fps): back to matting', t, false, true);
          }
        }
      }

      // ---- step down ----
      if (!inEmergency && windowFull && badShare >= K.BAD_SHARE && t - lastDownAt >= K.MIN_DWELL_MS) {
        const fpsNow = median(useWin.map((h) => h.fps).filter((x) => x > 0)) || s.fps || 1;
        const targetFps = cam ? Math.min(K.TARGET_FPS, cam * 0.95) : K.TARGET_FPS;
        const ratio = Math.max(0.01, Math.min(1, fpsNow / targetFps));           // < 1: we need the mask to cost about this much less
        const ms = segMed || s.segMs || 0;
        const wantMs = ms * ratio / 1.08;
        let idx = -1;
        for (let i = cur + 1; i < rungs.length; i++) {
          const r = rungs[i];
          if (r.engine !== rungs[cur].engine) {                                  // engine boundary: only from the end of an engine's sizes, only if predicted cheaper
            if (s.busy) break;
            if (cur !== lastIdxOfEngine(rungs[cur].engine)) break;
          }
          const p = predictMs(r, rungs[cur], ms);
          const crossing = r.engine !== rungs[cur].engine, known = !!(cost[r.engine] && cost[rungs[cur].engine]);
          if (crossing && known && p >= ms * 0.85) continue;                      // we KNOW the next engine is not cheaper: do not cross for nothing
          if (p > 0 && p <= wantMs) { idx = i; break; }
          if (crossing && known && p < ms * 0.85 && idx < 0) { idx = i; break; }
        }
        if (idx < 0) {                                                            // nothing predicted to fit: go straight to the smallest size of THIS engine (the best it can do), then verify.
          const endOfEngine = lastIdxOfEngine(rungs[cur].engine);                 // crawling one rung at a time through a slideshow helps nobody
          idx = endOfEngine > cur ? endOfEngine : Math.min(rungs.length - 1, cur + 1);
          if (idx > cur && rungs[idx].engine !== rungs[cur].engine) {
            const known = !!(cost[rungs[idx].engine] && cost[rungs[cur].engine]);
            if (s.busy || (known && predictMs(rungs[idx], rungs[cur], ms) >= ms * 0.85)) idx = cur;   // never cross while recording, never cross into an engine known to be no cheaper
          }
        }
        if (idx <= cur) return hold('floor');
        lastDownAt = t; if (t - lastUpAt < K.PROBE_FAIL_MS) upBackoff = Math.min(K.UP_BACKOFF_MAX, upBackoff * 2);
        return commit(rungs[idx].engine !== rungs[cur].engine ? 'swap-engine' : 'resize', rungs[idx], idx, 'sustained ' + Math.round(fpsNow) + ' fps, mask ' + Math.round(ms) + ' ms, predicted ' + Math.round(predictMs(rungs[idx], rungs[cur], ms)) + ' ms', t);
      }

      // ---- recovery ----
      const upOk = !bad && s.fps >= (cam ? Math.min(K.UP_FPS, cam * 0.95) : K.UP_FPS);
      goodSince = upOk ? (goodSince == null ? t : goodSince) : null;
      if (goodSince != null && t - goodSince >= upWait * upBackoff * 1000 && (inEmergency || cur > 0)) {
        if (inEmergency) {
          const to = lastMattingIdx();
          return commit('swap-engine', rungs[to], to, 'probing the matting model again', t, false, true);
        }
        const to = cur - 1, r = rungs[to];
        if (r.engine !== rungs[cur].engine && s.busy) return hold('busy');         // engine swap up waits for a quiet moment; resizing up does not
        const p = predictMs(r, rungs[cur], median(win.map((h) => h.segMs).filter((x) => x > 0)) || s.segMs);
        if (p > 0 && p > frameMs * K.MIN_UP_MARGIN) { goodSince = t; return hold('no-headroom'); }   // restart the clock; look again in a while
        return commit(r.engine !== rungs[cur].engine ? 'swap-engine' : 'resize', r, to, 'steady ' + Math.round(s.fps) + ' fps with headroom', t, false, true);
      }
      return hold(modelBound ? '' : 'camera-bound');
    }

    function lastMattingIdx() { return rungs.length - 1; }
    /** True when no later rung can be cheaper: the end of the chain, or the end of this engine's sizes with every later engine KNOWN to be no cheaper. */
    function isFloor(ms) {
      if (inEmergency) return false;
      for (let i = cur + 1; i < rungs.length; i++) {
        const r = rungs[i], crossing = r.engine !== rungs[cur].engine;
        if (!crossing) return false;
        const known = !!(cost[r.engine] && cost[rungs[cur].engine]);
        if (!known || predictMs(r, rungs[cur], ms) < ms * 0.85) return false;
      }
      return true;
    }
    function lastIdxOfEngine(e) { let i = -1; rungs.forEach((r, k) => { if (r.engine === e) i = k; }); return i; }
    /** The caller ASKED for the move; it only becomes true when the caller confirms with applied(), so a failed engine load never desyncs us. */
    function commit(kind, rung, idx, why, t, isEmergency, isUp) {
      const a = move(kind, rung, idx, why, t); a.up = !!isUp; pending = { a, t }; pendingFps = lastFps; return a;
    }
    let pending = null;
    function applied(a, t) {
      const at = t != null ? t : (pending ? pending.t : 0);
      if (a.emergency) { inEmergency = true; hopelessSince = null; emFps = pendingFps; }
      else { inEmergency = false; if (a.rungIndex >= 0) cur = a.rungIndex; }
      if (a.up) { lastUpAt = at; if (!inEmergency && cur === 0) upBackoff = Math.max(1, upBackoff / 2); }
      lastChangeAt = at; goodSince = null; hist.length = 0; pending = null; pendingProbe = !!a.up;
    }
    /** The caller could not apply the move (engine failed to load). Stay where we are and wait a full dwell before asking again. */
    function failed(a, t) { lastDownAt = t != null ? t : lastDownAt; lastChangeAt = t != null ? t : lastChangeAt; goodSince = null; pending = null; }
    return {
      tick, applied, failed,
      state: () => ({ rung: rungOf(), index: inEmergency ? -1 : cur, emergency: inEmergency, upWaitSec: upWait * upBackoff, costs: Object.assign({}, cost), rungs: rungs.length }),
      rungs: () => rungs.slice(), predictMs,
      setChain(chain, engine, edge) { rungs = buildRungs(chain, engine, edge); cur = Math.max(0, rungs.findIndex((r) => r.engine === engine && r.edge === edge)); inEmergency = false; },
    };
  }

  VS.QualityGovernor = { create, buildRungs, CONSTANTS: C, DEFAULT_CHAIN };
  if (typeof module !== 'undefined') module.exports = VS.QualityGovernor;
})(typeof self !== 'undefined' ? self : this);
