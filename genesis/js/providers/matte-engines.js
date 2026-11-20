/**
 * Matte engines: lets the high-quality slot (the one that normally runs MODNet) use other pretrained models, without touching app.js.
 *   modnet   MODNet, the default, unchanged
 *   edgetam  MODNet + EdgeTAM cleanup (removes stray blobs; ~30 MB extra download; Apache-2.0)
 *   birefnet BiRefNet-lite (best edges; WebGPU only; ~115 MB download; MIT)
 *   ppmatting-v2  PP-MattingV2 live matting BETA (v0.94; ~34 MiB; Apache-2.0). Shown only while flags.json ppmattingBeta = 1 (remote kill switch).
 *   ppmatting-hrnet  PP-Matting HRNet-W18 (v0.94; ~94 MiB; Apache-2.0): offline/export quality, benchmark-only in the live picker (localStorage vs_ppm_lab = 1 shows it).
 * The choice is stored in localStorage 'vs_matte_engine'. Picking one also selects the MODNet slot in the Segmentation model list,
 * because that slot is what instantiates the router below. Loaded on demand from js/loader.js.
 */
(function (root) {
  'use strict';
  const V = root.VS = root.VS || {};
  const KEY = 'vs_matte_engine';
  const ENGINES = [
    ['modnet', 'MODNet (default)'],
    ['edgetam', 'MODNet + EdgeTAM cleanup (Apache-2.0, +30 MB)'],
    ['birefnet', 'BiRefNet lite (best edges, needs WebGPU, +115 MB, MIT)'],
    ['ppmatting-v2', 'PP-MattingV2 (BETA, live matting, +34 MB, Apache-2.0)'],
    ['genesis-hybrid', 'Genesis Hybrid (BETA: PP-MattingV2 + edge refinement, +34 MB, Apache-2.0)'],
    ['genesis-hybrid-tam', 'Genesis UltraMatte (BETA: PP-MattingV2 + EdgeTAM tracking + high-res boundary tiles, +64 MB, Apache-2.0)'],
    ['ppmatting-hrnet', 'PP-Matting HRNet (benchmark only, heavy, +94 MB, Apache-2.0)']
  ];
  const PP_DEPS = ['js/providers/ppmatting-core.js', 'js/providers/temporal-matte.js', 'js/providers/video-guard.js', 'js/providers/engine-policy.js', 'js/providers/ppmatting-provider.js'];
  const DEPS = ['js/providers/model-store.js', 'js/providers/temporal-mask.js', 'js/providers/edgetam-core.js', 'js/providers/birefnet-provider.js', 'js/providers/edgetam-provider.js'].concat(PP_DEPS);
  const HY_DEPS = ['js/providers/band-refine-core.js', 'js/providers/hybrid-provider.js'];

  /** Which engines the picker may show. The PP-Matting beta follows the remote flag (default on) and a local override localStorage vs_pp_beta = 0 / 1. */
  function betaOn() {
    try { const v = localStorage.getItem('vs_pp_beta'); if (v === '0') return false; if (v === '1') return true; } catch (e) { /* private mode */ }
    const F = V.Flags; return !F || F.get('ppmattingBeta') !== 0;
  }
  /** Release-gate routing (engine-policy.js): flag on, and the device is not low-tier. localStorage vs_pp_force = 1 skips the tier check (for testing on a weak phone). */
  function ppAllowed(id) {
    try {
      if (!betaOn()) return false;
      if (localStorage.getItem('vs_pp_force') === '1' || !V.EnginePolicy) return true;
      if (id && V.EnginePolicy.isSlow && V.EnginePolicy.isSlow(id)) return false;   // v0.95: this device's own lab run measured it as unusably slow -> fall back to the default engine
      const nav = typeof navigator !== 'undefined' ? navigator : {};
      const dev = { mobile: /Android|iPhone|iPad|Mobile/i.test(nav.userAgent || ''), cores: nav.hardwareConcurrency, memGB: nav.deviceMemory, webgpu: !!nav.gpu };
      return V.EnginePolicy.tier(dev) !== 'low';
    } catch (e) { return false; }
  }
  function labOn() { try { return localStorage.getItem('vs_ppm_lab') === '1'; } catch (e) { return false; } }
  function visibleEngines() { return ENGINES.filter((e) => ((e[0] === 'ppmatting-v2' || e[0] === 'genesis-hybrid' || e[0] === 'genesis-hybrid-tam') ? betaOn() : e[0] === 'ppmatting-hrnet' ? betaOn() && labOn() : true)); }

  function pref() { try { const v = localStorage.getItem(KEY); return visibleEngines().some((e) => e[0] === v) ? v : 'modnet'; } catch (e) { return 'modnet'; } }   // a hidden/removed engine (flag turned off) silently becomes MODNet
  function setPref(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode */ } }
  async function loadDeps() { for (const d of DEPS) await V.loadScript(d); for (const d of HY_DEPS) { try { await V.loadScript(d); } catch (e) { /* hybrid is optional */ } } }
  const depsReady = () => !!(V.EdgeTAMGate && V.BiRefNetSegmentationProvider && V.ModelStore && V.EdgeTAMCore && V.TemporalMask && V.PPMattingV2Provider);

  let installed = false;
  function installRouter() {
    if (installed || !V.MODNetWorkerProvider) return;
    installed = true;
    const Orig = V.MODNetWorkerProvider;
    const makeOrig = () => (Orig.isSupported() ? new Orig() : new V.MODNetSegmentationProvider());
    // A plain function (not a class): class prototypes are read-only, and we need instanceof against the original to keep working.
    function MatteEngineRouter() {
      const engine = pref();
      if (engine !== 'modnet' && depsReady()) {
        if (engine === 'birefnet') return new V.BiRefNetSegmentationProvider();
        if (engine === 'genesis-hybrid' && V.GenesisHybridProvider && V.GenesisHybridProvider.isSupported() && ppAllowed('ppmatting-v2')) return new V.GenesisHybridProvider();
        if (engine === 'genesis-hybrid-tam' && V.GenesisHybridProvider && V.GenesisHybridProvider.isSupported() && ppAllowed('ppmatting-v2')) return V.EdgeTAMGate.create(new V.GenesisHybridProvider());   // EdgeTAM drops stray blobs from the hybrid output; if EdgeTAM fails it passes the hybrid matte through
        if (engine === 'ppmatting-v2' && V.PPMattingV2Provider && V.PPMattingV2Provider.isSupported() && ppAllowed('ppmatting-v2')) return new V.PPMattingV2Provider();
        if (engine === 'ppmatting-hrnet' && V.PPMattingHRNetProvider && V.PPMattingHRNetProvider.isSupported() && ppAllowed('ppmatting-hrnet')) return new V.PPMattingHRNetProvider();
        if (engine === 'edgetam') return V.EdgeTAMGate.create(makeOrig());
      }
      return new Orig();
    }
    Object.setPrototypeOf(MatteEngineRouter, Orig);      // static helpers (isSupported, threadsFor, webgpuAllowed...) keep working
    MatteEngineRouter.prototype = Orig.prototype;
    V.MODNetWorkerProvider = MatteEngineRouter;
    V.MatteEnginesOriginal = Orig;
  }

  function addPicker() {
    const sel = document.getElementById('modelSelect');
    if (!sel || document.getElementById('matteEngineSelect')) return;
    const field = sel.closest('.field');
    if (!field) return;
    const wrap = field.cloneNode(false);
    const lab = document.createElement('label'); lab.htmlFor = 'matteEngineSelect'; lab.textContent = 'High-quality engine';
    const s = document.createElement('select'); s.id = 'matteEngineSelect'; s.setAttribute('aria-label', 'High-quality matting engine');
    for (const [v, t] of visibleEngines()) { const o = document.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o); }
    s.value = pref();
    const note = document.createElement('div'); note.className = 'honesty-note'; note.style.marginTop = '6px';
    wrap.appendChild(lab); wrap.appendChild(s); wrap.appendChild(note);
    field.parentNode.insertBefore(wrap, field.nextSibling);
    const msg = () => { note.textContent = s.value === 'birefnet' && !(navigator.gpu) ? 'This browser has no WebGPU, so BiRefNet cannot run here; the normal engine is used instead.' : /^(ppmatting|genesis-hybrid)/.test(s.value) ? 'Beta: your default engine is unchanged. If this engine cannot start or is too slow, the normal engine is used instead. Everything runs on this device; no frames are uploaded.' : ''; };
    msg();
    s.addEventListener('change', async () => {
      setPref(s.value); msg();
      if (s.value !== 'modnet') {
        note.textContent = 'Loading engine code...';
        try { await loadDeps(); installRouter(); msg(); } catch (e) { note.textContent = 'Could not load the engine code: ' + e.message; return; }
        sel.value = 'modnet';                                  // the MODNet slot is what creates the router
      }
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function boot() {
    installRouter();                                           // harmless when pref is modnet: router returns the original class
    if (pref() !== 'modnet') { try { await loadDeps(); } catch (e) { /* router falls back to MODNet */ } }
    addPicker();
  }

  V.MatteEngines = { ENGINES, visibleEngines, betaOn, pref, setPref, boot, installRouter, loadDeps };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.MatteEngines;
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); }
})(typeof window !== 'undefined' ? window : globalThis);
