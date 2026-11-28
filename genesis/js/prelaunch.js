/* Genesis · pre-launch teaser. Until config.studioOpen is true, pressing Start camera still rolls the camera and a cinematic
 * "Coming soon" tag appears on the picture immediately. Recording and Go Live are held back while the tag is up.
 * Owner/testing bypass: open any page once with ?dev=1 (turn off with ?dev=0) — the same switch the developer pages already use.
 * Presentation + click guard only: it never touches camera, segmentation, rendering or storage code, and it is NOT a security boundary. */
(function () {
  'use strict';
  try {
    if (/[?&]dev=0\b/.test(location.search)) localStorage.removeItem('g_dev');
    if (/[?&]dev=1\b/.test(location.search)) localStorage.setItem('g_dev', '1');
  } catch (e) {}
  var cfg = (window.VS && window.VS.config) || {};
  var owner = false; try { owner = localStorage.getItem('g_dev') === '1'; } catch (e) {}
  if (cfg.studioOpen === true || owner) return;               // launched, or owner testing: full studio

  var frame = document.getElementById('previewFrame'), shell = document.getElementById('studioShell'); if (!frame) return;
  var tag = document.createElement('div'); tag.className = 'pl-tag'; tag.setAttribute('role', 'status'); tag.setAttribute('aria-live', 'polite');
  tag.innerHTML = '<span class="pl-kicker">GENESIS</span><strong class="pl-title">COMING SOON</strong><span class="pl-line" aria-hidden="true"></span>';
  frame.appendChild(tag);
  function show() { tag.classList.add('on'); if (shell) shell.setAttribute('data-prelaunch', '1'); }
  function pulse() { tag.classList.remove('pulse'); void tag.offsetWidth; tag.classList.add('pulse'); }
  var cameraOn = function () { return !!shell && shell.dataset.cam === 'on'; };

  /* Start camera (any of the entry points): let it roll, and show the tag straight away */
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#startBtn, #dockStart, #quickRecordBtn'); if (!t) return;
    if (t.id === 'quickRecordBtn' && cameraOn()) { e.preventDefault(); e.stopImmediatePropagation(); show(); pulse(); return; }   // would start recording
    show();
  }, true);
  /* Recording / live are held back during the teaser */
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#recordBtn, #quickLiveBtn, #transportLiveBtn'); if (!t) return;
    e.preventDefault(); e.stopImmediatePropagation(); show(); pulse();
  }, true);
  /* If the camera comes up by another route (resume, ?action=start), make sure the tag is there */
  setInterval(function () { if (cameraOn() && !tag.classList.contains('on')) show(); }, 700);
  if (shell && shell.dataset.cam === 'on') show();
})();
