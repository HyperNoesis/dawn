/**
 * Engine policy (v0.94): pure decision logic (no DOM) for "which matting engine for which job", and the hard release gate from the
 * research brief (Genesis_Segmentation_Model_Research_Decision_2026-11-16.pdf, sections 04, 05, 06).
 *
 *   tier(device)                      'low' | 'mid' | 'high'
 *   liveOrder(ctx)                    ordered live engines to try; the PREVIOUS default is always last, so nothing can end with no engine
 *   exportEngine(ctx)                 which engine does post-capture / still export
 *   placement(compare)                STOP CONDITION: better stills but worse motion -> still/export only, never live
 *   evaluateGate(report, targets)     release gate from a benchmark report: per-gate pass | fail | pending (needs a human / real device)
 *   canPromote(gate, flags)           PP-MattingV2 may become the DEFAULT only if every gate passes AND flag promotePPMatting is on
 *
 * Nothing here changes the default engine. Default stays Auto (RVM -> MODNet -> MediaPipe) / MODNet until canPromote() is true.
 */
(function (root) {
  'use strict';

  const ENGINES = {
    'ppmatting-v2':    { label: 'PP-MattingV2 (beta)',       job: 'live',   status: 'beta',         licence: 'Apache-2.0' },
    'ppmatting-hrnet': { label: 'PP-Matting HRNet (export)', job: 'export', status: 'experimental', licence: 'Apache-2.0' },
    'modnet':          { label: 'MODNet',                    job: 'live',   status: 'default',      licence: 'Apache-2.0' },
    'rvm':             { label: 'RVM (GPL-3.0, under review)', job: 'live', status: 'retained',     licence: 'GPL-3.0' },
    'mediapipe':       { label: 'MediaPipe (light fallback)', job: 'live',  status: 'fallback',     licence: 'Apache-2.0' },
    'birefnet':        { label: 'BiRefNet-lite (WebGPU)',    job: 'still',  status: 'experimental', licence: 'MIT' },
    'edgetam':         { label: 'EdgeTAM (mask guide, not alpha)', job: 'guide', status: 'optional', licence: 'Apache-2.0' }
  };

  /** device: { mobile, cores, memGB, webgpu } (any may be missing). Phones with few cores / little RAM are 'low'. */
  function tier(d) {
    d = d || {};
    const cores = d.cores || 2, mem = d.memGB || 2;
    if (d.mobile) return cores <= 4 || mem <= 3 ? 'low' : 'mid';
    if (cores <= 2 || mem <= 2) return 'low';
    return cores >= 8 && d.webgpu ? 'high' : 'mid';
  }

  /**
   * ctx: { device, flags:{ppmattingBeta}, pref (engine the user picked), measured:{[id]:{p95Ms}}, budgetMs (default 1000/24) }
   * Returns { order:[ids], reasons:[strings] }. 'modnet' (the shipped default) is always present as the last resort before 'mediapipe'.
   */
  function liveOrder(ctx) {
    const c = ctx || {}, t = tier(c.device), budget = c.budgetMs || 1000 / 24, reasons = [], order = [];
    const betaOn = !!(c.flags && c.flags.ppmattingBeta);
    const slow = (id) => c.measured && c.measured[id] && c.measured[id].p95Ms > budget;
    if (c.pref === 'ppmatting-v2' && betaOn) {
      if (t === 'low') reasons.push('Low-tier device: PP-MattingV2 is not tried first; the lighter path is used.');
      else if (slow('ppmatting-v2')) reasons.push('PP-MattingV2 p95 ' + Math.round(c.measured['ppmatting-v2'].p95Ms) + ' ms is over the ' + Math.round(budget) + ' ms budget; falling back.');
      else { order.push('ppmatting-v2'); reasons.push('PP-MattingV2 beta chosen by the user (flag on).'); }
    } else if (c.pref === 'ppmatting-v2' && !betaOn) reasons.push('PP-MattingV2 flag is off; default engines used.');
    if (t === 'low') { order.push('mediapipe'); reasons.push('Low-tier device: MediaPipe first.'); }
    order.push('modnet');
    if (t !== 'low') order.push('mediapipe');
    return { order: order.filter((x, i) => order.indexOf(x) === i), reasons, tier: t };
  }

  /** Post-capture engine. HRNet when the user is on a device that can wait for it, else PP-MattingV2, else nothing model-based. */
  function exportEngine(ctx) {
    const c = ctx || {}, t = tier(c.device);
    if (c.flags && c.flags.ppmattingBeta === 0) return { engine: null, reason: 'PP-Matting export flag is off.' };
    if (t === 'high' || t === 'mid') return { engine: 'ppmatting-hrnet', fallback: 'ppmatting-v2', reason: 'Offline export may use the heavier model.' };
    return { engine: 'ppmatting-v2', fallback: null, reason: 'Low-tier device: lighter model for export.' };
  }

  /**
   * STOP CONDITION (brief section 06): "If PP-MattingV2 produces better stills but worse motion consistency, keep it for still/export and do not force it into live preview."
   * compare: { sadRatio, dtssdRatio }  = candidate / baseline (lower is better for both). Returns { live, export, why }.
   */
  function placement(compare) {
    const c = compare || {};
    const betterStill = c.sadRatio != null && c.sadRatio <= 1.0;
    const worseMotion = c.dtssdRatio != null && c.dtssdRatio > 1.0;
    if (betterStill && worseMotion) return { live: false, export: true, why: 'Better stills but worse temporal stability: still/export only.' };
    if (betterStill && !worseMotion) return { live: true, export: true, why: 'Better or equal stills and motion.' };
    if (!betterStill && !worseMotion) return { live: true, export: false, why: 'Stills worse but motion at least as stable: live candidate only; export keeps the better still engine.' };
    return { live: false, export: false, why: 'Worse on both: not placed.' };
  }

  const DEFAULT_TARGETS = { fpsMin: 24, p95MsMax: 1000 / 24, flickerRatioMax: 1.0, memGrowthMBMax: 150, sessionMinutes: 10 };

  /**
   * report (from tools/matting-bench or the in-app lab):
   * { engine, device:{...}, fps, p95Ms, flickerRatio (refined or raw candidate / baseline), sadRatio, gradRatio, dtssdRatio,
   *   memGrowthMB, sessionMinutes, recoveryFailures, blackFrames, uploadsFrames:boolean,
   *   manual:{ hairFingers:boolean|undefined, realDevice:boolean|undefined, licenceReviewed:boolean|undefined } }
   * Every gate is 'pass' | 'fail' | 'pending'. 'pending' means the number or human check is missing (never silently treated as a pass).
   */
  function evaluateGate(report, targets) {
    const r = report || {}, t = Object.assign({}, DEFAULT_TARGETS, targets || {}), g = {};
    const num = (v) => typeof v === 'number' && isFinite(v);
    const cmp = (v, ok) => (num(v) ? (ok(v) ? 'pass' : 'fail') : 'pending');
    g.fps = cmp(r.fps, (v) => v >= t.fpsMin);
    g.p95 = cmp(r.p95Ms, (v) => v <= t.p95MsMax);
    g.flicker = cmp(r.flickerRatio, (v) => v <= t.flickerRatioMax);
    g.stillQuality = cmp(r.sadRatio, (v) => v <= 1.0);
    g.edgeDetail = cmp(r.gradRatio, (v) => v <= 1.0);
    g.memory = cmp(r.memGrowthMB, (v) => v <= t.memGrowthMBMax);
    g.session = num(r.sessionMinutes) ? (r.sessionMinutes >= t.sessionMinutes ? 'pass' : 'fail') : 'pending';
    g.recovery = (num(r.recoveryFailures) && num(r.blackFrames)) ? (r.recoveryFailures === 0 && r.blackFrames === 0 ? 'pass' : 'fail') : 'pending';
    g.localOnly = typeof r.uploadsFrames === 'boolean' ? (r.uploadsFrames ? 'fail' : 'pass') : 'pending';
    const m = r.manual || {};
    g.hairFingersRealFootage = typeof m.hairFingers === 'boolean' ? (m.hairFingers ? 'pass' : 'fail') : 'pending';
    g.realDevice = typeof m.realDevice === 'boolean' ? (m.realDevice ? 'pass' : 'fail') : 'pending';
    g.licenceReviewed = typeof m.licenceReviewed === 'boolean' ? (m.licenceReviewed ? 'pass' : 'fail') : 'pending';
    const vals = Object.values(g);
    return { gates: g, pass: vals.every((v) => v === 'pass'), failed: Object.keys(g).filter((k) => g[k] === 'fail'), pending: Object.keys(g).filter((k) => g[k] === 'pending') };
  }

  /** The only way PP-MattingV2 can become the default. Both a passing gate and an explicit flag are required. */
  function canPromote(gate, flags) { return !!(gate && gate.pass && flags && flags.promotePPMatting === 1); }


  /**
   * Measured-speed memory (v0.95). The lab (ppmatting-lab.js) records a live run's p95 here (localStorage vs_measured, per browser/device, only runs of
   * >= 30 frames). The engine router then refuses an engine whose OWN measured p95 on THIS device is over the unusable limit (default 1000/12 ms, i.e. under
   * ~12 fps at the slow-frame tail), instead of guessing from core count. No record = no opinion (the tier rule still applies). Failures are silent.
   */
  const MEASURED_KEY = 'vs_measured', UNUSABLE_P95_MS = 1000 / 12;
  function getMeasured(store) {
    try { const st = store || (typeof localStorage !== 'undefined' ? localStorage : null); return st ? (JSON.parse(st.getItem(MEASURED_KEY) || '{}') || {}) : {}; } catch (e) { return {}; }
  }
  function recordMeasured(id, p95Ms, frames, store) {
    try {
      if (!id || !(p95Ms > 0) || !(frames >= 30)) return false;
      const st = store || (typeof localStorage !== 'undefined' ? localStorage : null); if (!st) return false;
      const m = getMeasured(st); m[id] = { p95Ms: Math.round(p95Ms * 10) / 10, frames, at: Date.now() }; st.setItem(MEASURED_KEY, JSON.stringify(m)); return true;
    } catch (e) { return false; }
  }
  function isSlow(id, limitMs, store) { const r = getMeasured(store)[id]; return !!(r && r.p95Ms > (limitMs || UNUSABLE_P95_MS)); }

  const api = { ENGINES, tier, liveOrder, exportEngine, placement, evaluateGate, canPromote, DEFAULT_TARGETS, getMeasured, recordMeasured, isSlow, UNUSABLE_P95_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {};
  root.VS.EnginePolicy = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
