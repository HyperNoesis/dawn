/* Engine quality-qualification registry (pure logic, no DOM).
 *
 * Device timing chooses AMONG quality-qualified routes; it never proves image quality.
 * An engine is 'approved' only when its entry carries held-out, consented, real-VIDEO alpha
 * evidence (participant-level split) and no critical-stratum regression. Anything else is
 * 'experimental' and is auto-promoted only if the user explicitly opts in. A change to the
 * weights, pre-processing or post-processing version invalidates an approval.
 *
 * Today NO engine has real held-out human alpha labels in this repository, so nothing but the
 * shipped baseline is 'approved'. That is deliberate and must not be edited without evidence. */
(function (root) {
  'use strict';
  const PREPROC = 'v1', POSTPROC = 'v1';   // bump when resize/normalise or mask-clean/refine behaviour changes

  const EVIDENCE_REQUIRED = { kind: 'real-video-heldout', minParticipants: 5, minClips: 20 };

  const REGISTRY = {
    'modnet':             { status: 'baseline',     models: ['modnet'], note: 'Shipped default since v0.17; the comparison baseline, not a quality claim.' },
    'ppmatting-v2':       { status: 'experimental', models: ['ppmatting-v2'], note: 'Real-still P3M sample (research-only, non-commercial data) only; no video or phone evidence.' },
    'genesis-hybrid':     { status: 'experimental', models: ['ppmatting-v2'], note: 'Tile re-run of PP-MattingV2, not a learned hair matting network; synthetic gates only.' },
    'genesis-hybrid-tam': { status: 'experimental', models: ['ppmatting-v2', 'edgetam'], note: 'UltraMatte: Hybrid + EdgeTAM gate; synthetic fixture + software-GL CI only.' },
    'ppmatting-hrnet':    { status: 'experimental', models: ['ppmatting-hrnet'], note: 'Export/still route; not a live route.' },
    'birefnet':           { status: 'experimental', models: ['birefnet-lite'], note: 'MIT code; training-dataset terms unresolved.' }
  };

  /* evidence: { kind, participants, clips, criticalRegression:boolean, weightsSha256:{id:hash}, preproc, postproc } */
  function evaluate(key, evidence, currentHashes) {
    const e = REGISTRY[key];
    if (!e) return { status: 'unknown', autoPromotable: false, reason: 'Engine is not in the qualification registry.' };
    if (e.status === 'baseline') return { status: 'baseline', autoPromotable: true, reason: e.note };
    const ev = evidence && evidence[key];
    if (!ev) return { status: 'experimental', autoPromotable: false, reason: 'No held-out real-video alpha evidence recorded. ' + e.note };
    if (ev.kind !== EVIDENCE_REQUIRED.kind) return { status: 'experimental', autoPromotable: false, reason: 'Evidence kind "' + ev.kind + '" is not ' + EVIDENCE_REQUIRED.kind + '.' };
    if ((ev.participants | 0) < EVIDENCE_REQUIRED.minParticipants || (ev.clips | 0) < EVIDENCE_REQUIRED.minClips) return { status: 'experimental', autoPromotable: false, reason: 'Held-out set too small to certify (' + (ev.participants | 0) + ' participants, ' + (ev.clips | 0) + ' clips).' };
    if (ev.criticalRegression) return { status: 'experimental', autoPromotable: false, reason: 'A critical stratum regressed against the baseline.' };
    if (ev.preproc !== PREPROC || ev.postproc !== POSTPROC) return { status: 'experimental', autoPromotable: false, reason: 'Pre/post-processing version changed since qualification.' };
    for (const id of e.models) {
      if (!currentHashes || !ev.weightsSha256 || !ev.weightsSha256[id] || ev.weightsSha256[id] !== currentHashes[id]) return { status: 'experimental', autoPromotable: false, reason: 'Weights for ' + id + ' do not match the qualified hash.' };
    }
    return { status: 'approved', autoPromotable: true, reason: 'Qualified on held-out real-video data.' };
  }

  /* Automatic mode: may this engine be tried as a premium candidate? */
  function allowedForAuto(key, opts) {
    opts = opts || {};
    const q = evaluate(key, opts.evidence, opts.hashes);
    if (q.autoPromotable) return { ok: true, status: q.status, reason: q.reason };
    if (opts.allowExperimental && q.status === 'experimental') return { ok: true, status: 'experimental', reason: 'Experimental route enabled by the user. ' + q.reason };
    return { ok: false, status: q.status, reason: q.reason };
  }

  function filterAuto(keys, opts) {
    const allowed = [], skipped = [];
    for (const k of keys) { const r = allowedForAuto(k, opts); (r.ok ? allowed : skipped).push(r.ok ? k : { key: k, reason: r.reason }); }
    return { allowed, skipped };
  }

  const api = { REGISTRY, EVIDENCE_REQUIRED, PREPROC, POSTPROC, evaluate, allowedForAuto, filterAuto };
  root.VS = root.VS || {};
  root.VS.EngineQualification = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
