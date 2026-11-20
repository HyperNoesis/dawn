/* Segmentation diagnostics (v0.74). Presentation only: reads measured values the engine already publishes
   (#stats, #renderHud, #transportStatus, #degradeBanner, the model and quality selects). Nothing is invented: "--" until measured.
   Technical names appear only here; the stage shows a plain-language status pill. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var anchor = $('segState'); if (!anchor) return;
  var FRIENDLY = { fast: 'Performance', balanced: 'Balanced', quality: 'Detail', ultra: 'Ultra' };
  var det = document.createElement('details'); det.className = 'seg-diag';
  det.innerHTML = '<summary>Diagnostics</summary><dl id="segDiag"></dl><p class="seg-note">Measured in this session. Frame time is sampled once a second.</p>';
  var motionToggle = document.createElement('button');
  motionToggle.type = 'button';
  motionToggle.className = 'seg-motion-toggle';
  motionToggle.style.cssText = 'display:block;width:100%;margin-top:8px;padding:9px 12px;border:1px solid var(--line, #777);border-radius:9px;background:transparent;color:inherit;font:inherit;text-align:left;';
  motionToggle.addEventListener('click', function () {
    var enabled = window.VS && window.VS.maskMotionEnabled ? window.VS.maskMotionEnabled() : false;
    if (window.VS && window.VS.setMaskMotionEnabled) window.VS.setMaskMotionEnabled(!enabled);
    render();
  });
  det.appendChild(motionToggle);
  anchor.parentNode.insertBefore(det, anchor.nextSibling);
  var visual = document.createElement('section');
  visual.className = 'seg-alpha-inspector';
  visual.style.cssText = 'margin-top:12px;padding:10px;border:1px solid var(--line,#555);border-radius:12px;background:rgba(120,130,150,.06);';
  visual.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px"><b>Live alpha inspection</b><span id="segPreviewState" style="font-size:11px;opacity:.7">Waiting for matte…</span></div>' +
    '<div style="display:flex;gap:6px;margin-bottom:8px" role="group" aria-label="Matte preview mode">' +
      '<button type="button" data-seg-preview="source" aria-pressed="false">Original</button>' +
      '<button type="button" data-seg-preview="alpha" aria-pressed="true">Alpha</button>' +
      '<button type="button" data-seg-preview="edge" aria-pressed="false">Edges</button>' +
      '<button type="button" data-seg-preview="checker" aria-pressed="false">Cutout</button></div>' +
    '<canvas id="segPreviewCanvas" width="192" height="108" style="display:block;width:100%;max-height:220px;object-fit:contain;background:#111;border-radius:8px"></canvas>' +
    '<p style="font-size:11px;opacity:.7;margin:7px 0 0">Alpha is grayscale: white = foreground, black = transparent. Edges highlights uncertain boundaries. Cutout composites the source through the actual alpha over a checkerboard.</p>';
  det.appendChild(visual);
  var previewMode = 'alpha', previewCanvas = visual.querySelector('#segPreviewCanvas'), previewState = visual.querySelector('#segPreviewState');
  function renderPreview() {
    var p = window.VS && window.VS.segmentationPreview;
    if (!p || !p[previewMode] || !previewCanvas) { if (previewState) previewState.textContent = 'Waiting for matte…'; return; }
    var src = p[previewMode], w = src.width || p.width, h = src.height || p.height;
    if (!(w > 0 && h > 0)) return;
    if (previewCanvas.width !== w || previewCanvas.height !== h) { previewCanvas.width = w; previewCanvas.height = h; }
    var ctx = previewCanvas.getContext('2d'); ctx.clearRect(0, 0, w, h); ctx.drawImage(src, 0, 0, w, h);
    if (previewState) previewState.textContent = 'Updated ' + new Date(p.updatedAt).toLocaleTimeString();
  }
  visual.querySelectorAll('[data-seg-preview]').forEach(function (button) {
    button.style.cssText = 'flex:1;min-height:32px;border:1px solid var(--line,#777);border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;';
    button.addEventListener('click', function () {
      previewMode = button.getAttribute('data-seg-preview');
      visual.querySelectorAll('[data-seg-preview]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === button)); });
      renderPreview();
    });
  });
  window.addEventListener('vs:segmentation-preview', renderPreview);
  var dl = $('segDiag'), samples = [], fps = null, lat = null, stride = 1, low = false, prov = '';
  function read() {
    var t = ($('stats') && $('stats').textContent) || '';
    var f = t.match(/FPS:\s*(\d+)/), l = t.match(/Frame latency:\s*([\d.]+)/), s = t.match(/Mask refresh: 1 in (\d+)/), p = t.match(/Provider:\s*([^|]+)/);
    fps = f ? +f[1] : null; lat = l ? +l[1] : null; stride = s ? +s[1] : 1; low = /Low-light boost: active/.test(t); prov = p ? p[1].trim() : '';
  }
  var camera = function () { var s = ($('transportStatus') || {}).textContent || ''; return /previewing|recording/i.test(s); };
  var banner = function () { var b = $('degradeBanner'); return b && b.classList.contains('show') ? (b.textContent || '').trim() : ''; };
  function pct(a, p) { if (!a.length) return null; var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; }
  function status() {
    if (!camera()) return { tone: 'idle', pill: 'Camera off' };
    var b = banner();
    if (/could not start|crashed/i.test(b)) return { tone: 'bad', pill: 'Needs attention' };
    if (/^No person/i.test(b)) return { tone: 'warn', pill: 'No person found' };
    if (/^(Switched|Fixing)|slow|frame rate|lowered/i.test(b)) return { tone: 'warn', pill: 'Reduced quality' };
    if (fps == null) return { tone: 'ai', pill: 'Starting' };
    if (fps < 15) return { tone: 'warn', pill: 'Running slowly' };
    return { tone: 'ai', pill: 'Background removal active' };
  }
  var hud = $('previewHud'), pill = null;
  if (hud) { pill = document.createElement('span'); pill.className = 'pill seg-pill'; pill.id = 'segPill'; pill.setAttribute('aria-hidden', 'true'); hud.appendChild(pill); var rh = $('renderHud'); if (rh) rh.style.display = 'none'; }
  function engineLog() {
    var L = (window.VS && window.VS.segLog) || [];
    if (!L.length) return 'no changes this session';
    return L.slice(-4).map(function (e) { return esc(e.ev) + (e.why ? ' (' + esc(e.why) + ')' : '') + ' [out ' + esc(e.fps) + ', cam ' + esc(e.cam) + ', mask ' + esc(e.seg) + ' ms' + (e.edge ? ', ' + esc(e.edge) + ' px' : '') + (e.ms ? ', bench ' + esc(e.ms) + ' ms' : '') + ']'; }).join('<br>');
  }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function row(k, v) { return '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>'; }
  function render() {
    var run = camera(), s = status();
    if (pill) { pill.textContent = s.pill; pill.dataset.tone = s.tone; }
    if (run && lat != null) { samples.push(lat); if (samples.length > 120) samples.shift(); } if (!run) samples.length = 0;
    var cv = $('canvas'), m = $('modelSelect'), q = $('qualitySelect'), e = $('sharpQuality');
    var diag = window.VS && window.VS.diagState ? window.VS.diagState() : {};
    var mm = diag.maskMotion || null;
    var hy = diag.hybrid || null;
    var route = diag.matteRoute || null;
    var motionEnabled = window.VS && window.VS.maskMotionEnabled ? window.VS.maskMotionEnabled() : false;
    motionToggle.textContent = 'Motion alignment: ' + (motionEnabled ? 'ON — tap to disable' : 'OFF — tap to enable');
    motionToggle.disabled = !window.VS || !window.VS.setMaskMotionEnabled;
    dl.innerHTML =
      row('Background removal', run ? s.pill : 'Camera off') +
      row('Motion alignment', mm ? mm.status : '--') +
      row('Mask age', mm && mm.ageMs != null ? mm.ageMs + ' ms' : '--') +
      row('Motion confidence / coverage', mm ? mm.meanConfidence + ' / ' + mm.coverage : '--') +
      row('Propagation cost', mm && mm.durationMs != null ? mm.durationMs + ' ms' : '--') +
      row('Preset model', m ? (m.options[m.selectedIndex] ? m.options[m.selectedIndex].text.replace(/\s*\(.*\)/, '') : m.value) : '--') +
      row('Selected high-quality engine', route ? route.selectedLabel || route.selected : '--') +
      row('Actually active engine', route ? route.active || 'Starting' : (($('renderHud') && $('renderHud').textContent.trim()) || '--')) +
      row('Fallback reason', route && route.fallbackReason ? route.fallbackReason : 'None reported') +
      row('Engine in use', ($('renderHud') && $('renderHud').textContent.trim()) || '--') +
      row('Model', prov || '--') +
      row('Model long edge', diag.modelLongEdge ? diag.modelLongEdge + ' px' : '--') +
      row('Hybrid tiles refined / budget', hy ? hy.refined + ' / ' + hy.budget : '--') +
      row('Boundary tiles / cached', hy ? hy.tiles + ' / ' + hy.cached : '--') +
      row('Boundary band', hy ? hy.bandPct + '%' : '--') +
      row('Hybrid errors', hy ? hy.errors + (hy.lastError ? ' · ' + hy.lastError : '') : '--') +
      row('Edge quality', e ? (e.value === '2' ? 'High' : 'Fast') : '--') +
      row('Quality mode', q ? (FRIENDLY[q.value] || q.value) : '--') +
      row('Output size', cv ? cv.width + ' x ' + cv.height : '--') +
      row('Frame rate', run && fps != null ? fps + ' fps' : '--') +
      row('Frame time (now)', run && lat != null ? lat + ' ms' : '--') +
      row('Frame time p50 / p95', samples.length > 4 ? pct(samples, .5) + ' / ' + pct(samples, .95) + ' ms' : '--') +
      row('Cutout refresh', run ? (stride > 1 ? 'every ' + stride + ' frames' : 'every frame') : '--') +
      row('Low-light boost', run ? (low ? 'on' : 'off') : '--') +
      row('Camera delivers', run && window.__camFps ? window.__camFps + ' fps (asked of the camera)' : '--') +
      row('Person crop', run ? ((window.VS && window.VS.segLog) ? 'see log' : 'active only when it helps') : '--') +
      row('Why the engine changed', run ? engineLog() : '--');
    var qh = $('qualityHud'); if (qh && q && FRIENDLY[q.value] && qh.textContent !== FRIENDLY[q.value]) qh.textContent = FRIENDLY[q.value];
    renderPreview();
  }
  setInterval(function () { try { read(); render(); } catch (e) {} }, 1000);
  render();
})();
