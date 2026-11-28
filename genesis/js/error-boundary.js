'use strict';
/**
 * Safe global error reporting. Error messages can contain filenames, URLs or
 * provider responses; render them as text, never as HTML.
 */
(function () {
  function ensureToastHost() {
    let host = document.getElementById('vsErrorToastHost');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'vsErrorToastHost';
    host.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:min(92vw,420px);';
    document.body.appendChild(host);
    return host;
  }
  function showToast(message) {
    try {
      const host = ensureToastHost();
      if (host.children.length >= 3) return;
      const toast = document.createElement('div');
      toast.setAttribute('role', 'alert');
      toast.style.cssText = 'background:#1c1029;border:1px solid #ef445544;color:#f2eaff;padding:12px 14px;border-radius:10px;font-size:12.5px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,0.4);display:flex;gap:10px;align-items:flex-start;';
      const text = document.createElement('span');
      text.style.flex = '1';
      text.textContent = 'Something went wrong: ' + String(message || 'Unknown error').slice(0, 140) + '. You can keep going, or reload if things look stuck.';
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.setAttribute('aria-label', 'Dismiss');
      dismiss.textContent = '×';
      dismiss.style.cssText = 'background:none;border:none;color:#c9b8e6;cursor:pointer;font-size:15px;line-height:1;padding:0;';
      dismiss.addEventListener('click', () => toast.remove());
      toast.append(text, dismiss);
      host.appendChild(toast);
      setTimeout(() => toast.remove(), 12000);
    } catch (_) { /* the error boundary must never throw */ }
  }
  window.addEventListener('error', (event) => {
    if (!event || !event.message || event.message === 'Script error.') return;
    showToast(event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event && event.reason;
    showToast(reason && reason.message ? reason.message : String(reason || 'An operation failed'));
  });
  window.VS = window.VS || {};
  window.VS.reportError = showToast;
})();
