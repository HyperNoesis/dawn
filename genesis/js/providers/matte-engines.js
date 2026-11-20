/**
 * Matte engine router for Genesis Studio.
 *
 * Each engine owns its dependency list. An unavailable optional model must never
 * prevent an unrelated model from loading. Explicit user selection is honoured:
 * the router either constructs that engine or returns an unavailable-provider
 * that fails visibly during initialise; it never silently substitutes MODNet.
 */
(function (root) {
  'use strict';
  const V = root.VS = root.VS || {};
  const KEY = 'vs_matte_engine';
  const ENGINES = [
    ['modnet', 'MODNet (default)'],
    ['edgetam', 'MODNet + EdgeTAM cleanup (Apache-2.0, +30 MB)'],
    ['birefnet', 'BiRefNet lite (WebGPU, +115 MB, MIT)'],
    ['ppmatting-v2', 'PP-MattingV2 (BETA, +34 MB, Apache-2.0)'],
    ['genesis-hybrid', 'Genesis Hybrid (BETA: boundary refinement, +34 MB, Apache-2.0)'],
    ['genesis-hybrid-tam', 'Genesis UltraMatte (BETA: EdgeTAM + boundary refinement, +64 MB, Apache-2.0)'],
    ['ppmatting-hrnet', 'PP-Matting HRNet (lab / export benchmark, +94 MB, Apache-2.0)']
  ];

  let installed = false;
  let bootPromise = null;
  let lastError = null;
  let activeLabel = null;
  let fallbackReason = null;
  const scriptLoads = new Map();

  function betaOn() {
    try {
      const v = localStorage.getItem('vs_pp_beta');
      if (v === '0') return false;
      if (v === '1') return true;
    } catch (e) {}
    return !V.Flags || V.Flags.get('ppmattingBeta') !== 0;
  }

  function labOn() { try { return localStorage.getItem('vs_ppm_lab') === '1'; } catch (e) { return false; } }

  function visibleEngines() {
    return ENGINES.filter((e) => {
      if (e[0] === 'ppmatting-hrnet') return betaOn() && labOn();
      if (e[0] === 'ppmatting-v2' || e[0] === 'genesis-hybrid' || e[0] === 'genesis-hybrid-tam') return betaOn();
      return true;
    });
  }

  function pref() {
    try {
      const value = localStorage.getItem(KEY) || 'modnet';
      return visibleEngines().some((e) => e[0] === value) ? value : 'modnet';
    } catch (e) { return 'modnet'; }
  }

  function setPref(value) {
    if (!visibleEngines().some((e) => e[0] === value)) throw new Error('That matting engine is not currently available in the engine picker.');
    try { localStorage.setItem(KEY, value); } catch (e) {}
  }

  function getPolicy() { return V.MatteEnginePolicy || null; }

  async function ensurePolicy() {
    if (getPolicy()) return getPolicy();
    if (!V.loadScript) throw new Error('Genesis script loader is unavailable.');
    await V.loadScript('js/providers/matte-engine-policy.js');
    if (!getPolicy()) throw new Error('Matting engine policy did not initialise.');
    return getPolicy();
  }

  async function loadEngine(engine) {
    const policy = await ensurePolicy();
    if (engine === 'modnet') return { ok: true, engine, missing: [] };
    const files = policy.scriptsFor(engine);
    if (!files.length) return policy.resolve(engine, V);

    for (const file of files) {
      if (scriptLoads.has(file)) {
        await scriptLoads.get(file);
        continue;
      }
      const loading = V.loadScript(file);
      scriptLoads.set(file, loading);
      try { await loading; }
      catch (error) { scriptLoads.delete(file); throw new Error('Could not load ' + file + ': ' + (error.message || error)); }
    }
    return policy.resolve(engine, V);
  }

  function describeMissing(result) {
    if (!result || !result.missing || !result.missing.length) return 'The selected engine is not ready.';
    return result.label + ' is not ready. Missing: ' + result.missing.join(', ') + '.';
  }

  function unavailableProvider(Original, engine, message) {
    class UnavailableMatteProvider extends Original {
      constructor() {
        super();
        this.routeError = message;
        this.requestedEngine = engine;
        this.label = engine + ' (unavailable)';
      }
      async initialize() { throw new Error(this.routeError); }
      async segment() { throw new Error(this.routeError); }
    }
    return new UnavailableMatteProvider();
  }

  function originalProvider(Original) {
    if (Original && Original.isSupported && Original.isSupported()) return new Original();
    return new V.MODNetSegmentationProvider();
  }

  function installRouter() {
    if (installed) return;
    const Original = V.MODNetWorkerProvider;
    if (!Original) return;
    installed = true;
    V.MatteEnginesOriginal = Original;

    function MatteEngineRouter() {
      const engine = pref();
      if (engine === 'modnet') return originalProvider(Original);

      const readiness = (getPolicy() || {}).resolve
        ? getPolicy().resolve(engine, V)
        : { ok: false, missing: ['Engine policy is not loaded'] };

      // A selected model is never silently changed to MODNet. The app's normal
      // startup error path will report this exact failure and show its fallback.
      if (!readiness.ok) return unavailableProvider(Original, engine, describeMissing(readiness));

      if (engine === 'edgetam') return V.EdgeTAMGate.create(originalProvider(Original));
      if (engine === 'birefnet') return new V.BiRefNetSegmentationProvider();
      if (engine === 'ppmatting-v2') return new V.PPMattingV2Provider();
      if (engine === 'ppmatting-hrnet') return new V.PPMattingHRNetProvider();
      if (engine === 'genesis-hybrid') return new V.GenesisHybridProvider();
      if (engine === 'genesis-hybrid-tam') return V.EdgeTAMGate.create(new V.GenesisHybridProvider());

      return unavailableProvider(Original, engine, 'Unsupported matting engine: ' + engine);
    }

    Object.setPrototypeOf(MatteEngineRouter, Original);
    MatteEngineRouter.prototype = Original.prototype;
    V.MODNetWorkerProvider = MatteEngineRouter;
  }

  function reportActive(provider, reason) {
    activeLabel = provider ? String(provider.current || provider.label || 'Unknown engine') : null;
    fallbackReason = reason || null;
    if (reason) lastError = reason;
  }

  function getStatus(provider) {
    return {
      selected: pref(),
      selectedLabel: (visibleEngines().find((e) => e[0] === pref()) || [null, 'Unknown engine'])[1],
      active: provider ? String(provider.current || provider.label || 'Unknown engine') : activeLabel,
      fallback: !!fallbackReason,
      fallbackReason,
      lastError,
      ready: !lastError
    };
  }

  async function ensureEngine(engine) {
    try {
      const result = await loadEngine(engine || pref());
      if (!result.ok) {
        lastError = describeMissing(result);
        return { ok: false, error: lastError, readiness: result };
      }
      lastError = null;
      return { ok: true, engine: engine || pref(), readiness: result };
    } catch (error) {
      lastError = String(error && error.message || error);
      return { ok: false, error: lastError };
    }
  }

  function addPicker() {
    const sel = document.getElementById('modelSelect');
    if (!sel || document.getElementById('matteEngineSelect')) return;
    const field = sel.closest('.field');
    if (!field) return;

    const wrap = field.cloneNode(false);
    const lab = document.createElement('label');
    lab.htmlFor = 'matteEngineSelect';
    lab.textContent = 'High-quality engine';

    const select = document.createElement('select');
    select.id = 'matteEngineSelect';
    select.setAttribute('aria-label', 'High-quality matting engine');
    for (const [value, label] of visibleEngines()) {
      const option = document.createElement('option');
      option.value = value; option.textContent = label; select.appendChild(option);
    }
    select.value = pref();

    const note = document.createElement('div');
    note.className = 'honesty-note';
    note.style.marginTop = '6px';
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');

    const explain = () => {
      if (select.value === 'birefnet' && !(navigator.gpu)) return 'BiRefNet requires WebGPU. This browser may not be able to run it.';
      if (select.value === 'genesis-hybrid-tam') return 'Experimental. Runs PP-MattingV2, EdgeTAM subject gating and local boundary refinement. Quality and speed still require real-device validation.';
      if (select.value === 'genesis-hybrid') return 'Experimental. Uses PP-MattingV2 with local boundary refinement. Quality and speed still require real-device validation.';
      if (select.value === 'ppmatting-v2' || select.value === 'ppmatting-hrnet') return 'Experimental model. The live performance governor may resize it, but the selected engine will not be silently replaced.';
      if (select.value === 'edgetam') return 'Adds subject-level stray-object cleanup to the soft matte. It does not create hair alpha detail.';
      return 'Uses the standard MODNet matting path.';
    };

    note.textContent = explain();
    wrap.appendChild(lab); wrap.appendChild(select); wrap.appendChild(note);
    field.parentNode.insertBefore(wrap, field.nextSibling);

    select.addEventListener('change', async () => {
      const previous = pref();
      note.textContent = 'Preparing ' + select.options[select.selectedIndex].text + '…';
      const result = await ensureEngine(select.value);
      if (!result.ok) note.textContent = 'Engine preparation failed: ' + result.error;
      else note.textContent = explain();
      setPref(select.value);
      installRouter();
      // The router is instantiated through the MODNet worker slot. A selected
      // advanced engine is constructed there, while the settings remain clear.
      sel.value = 'modnet';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      if (!result.ok) fallbackReason = result.error;
    });
  }

  async function boot() {
    installRouter();
    const selected = pref();
    if (selected !== 'modnet') {
      const result = await ensureEngine(selected);
      if (!result.ok) fallbackReason = result.error;
    }
    addPicker();
    return getStatus();
  }

  V.MatteEngines = {
    ENGINES,
    visibleEngines,
    betaOn,
    pref,
    setPref,
    loadEngine,
    ensureEngine,
    installRouter,
    reportActive,
    getStatus,
    boot,
    get ready() { return bootPromise || Promise.resolve(getStatus()); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = V.MatteEngines;
  const start = () => {
    if (!bootPromise) bootPromise = boot().catch((error) => {
      lastError = String(error && error.message || error);
      addPicker();
      return getStatus();
    });
    return bootPromise;
  };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
