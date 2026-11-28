/* Atelier v2.1 · Pass 4a — Studio first-use state (spec §12B).
 * Before the camera is running the only visible action is "Start your camera"; the workspace appears once a real frame is live.
 * Presentation only: it sets one attribute (data-fu) that css/atelier-studio.css reads. It never touches camera, segmentation,
 * recording or any panel id/handler. Fail-safe: any error, or no camera signal for the page's lifetime in a broken state, leaves the full studio visible. */
(function () {
  'use strict';
  var shell = document.getElementById('studioShell'); if (!shell) return;
  var status = document.getElementById('transportStatus'), video = document.getElementById('video');
  function cameraLive() {
    try {
      if (shell.dataset.cam === 'on') return true;
      if (status && /previewing|recording/i.test(status.textContent || '')) return true;
      return !!(video && video.srcObject && video.readyState >= 2 && video.videoWidth > 0 && !video.paused);
    } catch (e) { return true; }
  }
  var locked = false;   // once the studio has been revealed in this page session it stays revealed (no flicker when states change)
  function sync() { try { if (!locked && cameraLive()) locked = true; shell.dataset.fu = locked ? 'awake' : 'asleep'; } catch (e) { shell.dataset.fu = 'awake'; } }
  window.__fuReady = true;
  sync();
  if (status && window.MutationObserver) new MutationObserver(sync).observe(status, { childList: true, characterData: true, subtree: true });
  new MutationObserver(sync).observe(shell, { attributes: true, attributeFilter: ['data-cam'] });
  if (video) { ['playing', 'loadeddata', 'resize'].forEach(function (ev) { video.addEventListener(ev, sync); }); }
  setInterval(sync, 1000);
})();
