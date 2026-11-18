/**
 * VideoGuard (v0.94): frame-sequence intelligence that sits AFTER a matting model and BEFORE the temporal filter.
 * Research brief, pillar 4: scene-change detection, occlusion handling, recovery when tracking loses the subject, no silent black frames or stuck masks.
 *
 *   const g = VS.VideoGuard.create();
 *   const d = g.step({ alpha: Uint8Array, w, h, luma: Uint8Array|null, lw, lh });   // luma = tiny grayscale thumbnail of the SOURCE frame (optional, e.g. 32x18)
 *   d = { state, resetTemporal, useHeld, fade, sceneCut, reasons[] }
 *       state          'tracking' | 'occluded' | 'lost' | 'recovering'
 *       resetTemporal  true -> call TemporalMatte.reset() BEFORE step() (scene cut or recovery: old frames must not ghost into the new picture)
 *       useHeld        true -> show held() (the last good matte, faded) instead of the model output
 *       fade           0..1 multiplier for the held matte (1 -> 0 over holdFrames, so a lost subject never leaves a stuck mask)
 *   g.held()          last good alpha (owned by g; copy if you keep it)
 *   g.reset()         on camera restart / engine switch
 *
 * Signals: coverage = fraction of pixels with alpha > 127 (cheap); centroid jump; source-luma change on a thumbnail.
 *   scene cut   : mean |luma delta| >= cutLuma (default 28/255) AND coverage or centroid moved -> reset temporal, never hold across a cut
 *   occlusion   : coverage dropped to <= occludeBelow (default 0.6) of its running level but above lostBelow -> keep tracking (the model is allowed to follow it)
 *   lost        : coverage <= lostBelow (default 0.05 of running level, or an absolute floor) for lostFrames in a row -> hold the last good matte, fade out
 *   recovering  : coverage returns above recoverAbove (default 0.5 of running level) -> reset temporal once, then back to tracking
 * It never smooths or edits pixels. It only tells the caller when to reset, hold or fade.
 */
(function (root) {
  'use strict';
  const DEFAULTS = {
    cutLuma: 28, cutCoverageShift: 0.25, cutCentroidShift: 0.30,
    occludeBelow: 0.6, lostBelow: 0.05, absFloor: 0.002, lostFrames: 3, holdFrames: 12, recoverAbove: 0.5, level: 0.1
  };

  function coverageAndCentroid(a, w, h) {
    let n = 0, sx = 0, sy = 0;
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) if (a[i] > 127) { n++; sx += x; sy += y; }
    const cov = n / (w * h);
    return { cov, cx: n ? sx / n / w : 0.5, cy: n ? sy / n / h : 0.5 };
  }

  function meanAbsDiff(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; }

  function create(options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    let state = 'tracking', level = 0, prevLuma = null, prevCov = null, lostRun = 0, holdAge = 0, lastGood = null, lastGoodLen = 0, prevC = null;

    function reset() { state = 'tracking'; level = 0; prevLuma = null; prevCov = null; lostRun = 0; holdAge = 0; lastGood = null; lastGoodLen = 0; prevC = null; }

    function step(f) {
      const a = f.alpha, w = f.w, h = f.h, reasons = [];
      const m = coverageAndCentroid(a, w, h), cov = m.cov;
      let sceneCut = false, resetTemporal = false, useHeld = false, fade = 1;

      // 1) scene cut: the SOURCE picture changed a lot and the subject moved or appeared/disappeared at once
      if (f.luma && prevLuma && f.luma.length === prevLuma.length) {
        const d = meanAbsDiff(f.luma, prevLuma);
        const moved = prevCov != null && (Math.abs(cov - prevCov) >= o.cutCoverageShift * Math.max(prevCov, o.level) ||
          (prevC && Math.hypot(m.cx - prevC.cx, m.cy - prevC.cy) >= o.cutCentroidShift));
        if (d >= o.cutLuma && moved) { sceneCut = true; resetTemporal = true; reasons.push('scene cut (luma ' + d.toFixed(1) + ')'); level = 0; lostRun = 0; holdAge = 0; state = 'tracking'; }
      }
      if (f.luma) prevLuma = Uint8Array.from(f.luma);

      // 2) running level of "normal" coverage, learned only from healthy frames
      const healthy = level > 0 ? cov >= level * o.occludeBelow : cov > o.absFloor;
      if (healthy && cov > o.absFloor) level = level ? level * 0.9 + cov * 0.1 : cov;
      const rel = level > 0 ? cov / level : 1;
      const isLost = cov <= o.absFloor || (level > 0 && rel <= o.lostBelow);

      // 3) state machine
      if (sceneCut) { /* state already tracking; no hold across a cut */ }
      else if (isLost) {
        lostRun++;
        if (lostRun >= o.lostFrames && lastGood) { if (state !== 'lost') { holdAge = 0; reasons.push('subject lost'); } state = 'lost'; }
        else if (state !== 'lost') state = 'occluded';
      } else if (state === 'lost' || state === 'recovering') {
        if (rel >= o.recoverAbove) { state = 'tracking'; resetTemporal = true; lostRun = 0; holdAge = 0; reasons.push('recovered'); }
        else state = 'recovering';
      } else {
        lostRun = 0;
        state = level > 0 && rel <= o.occludeBelow ? 'occluded' : 'tracking';
        if (state === 'occluded') reasons.push('partial occlusion (tracking continues)');
      }

      if (state === 'lost') {
        holdAge++; useHeld = true; fade = Math.max(0, 1 - holdAge / o.holdFrames);
        if (fade === 0) reasons.push('hold expired: matte cleared, no stuck mask');
      } else if (state === 'tracking' && !isLost) {
        // remember the last good matte only while the subject is plainly there
        if (!lastGood || lastGood.length !== a.length) lastGood = new Uint8Array(a.length);
        lastGood.set(a); lastGoodLen = a.length;
      }
      prevCov = cov; prevC = { cx: m.cx, cy: m.cy };
      return { state, resetTemporal, useHeld, fade, sceneCut, coverage: cov, level, reasons };
    }

    return { step, reset, held: () => lastGood, state: () => state };
  }

  const api = { create, DEFAULTS, coverageAndCentroid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {};
  root.VS.VideoGuard = api;
})(typeof self !== 'undefined' ? self : this);
