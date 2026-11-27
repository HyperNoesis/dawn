/**
 * ModelStore: loads pretrained weights listed in models/registry.json.
 *   const { bytes, entry } = await VS.ModelStore.load('edgetam', { onProgress: (frac, label) => {} });
 *   bytes[<local file name>] -> Uint8Array
 *
 * Order: same-origin copy at models/<file> (put there by `node scripts/fetch-models.js`, works offline once cached), then the
 * GitHub release URL (often blocked by CORS in browsers, so treat it as a best-effort fallback only).
 * Downloaded files are size-checked, SHA-256 verified when the registry has a hash, and kept in Cache Storage keyed by hash so
 * a later visit does not download them again.
 */
(function (root) {
  'use strict';
  const CACHE = 'genesis-models-v1';
  let registryPromise = null;

  function registry() {
    if (!registryPromise) registryPromise = fetch('models/registry.json', { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error('models/registry.json: HTTP ' + r.status);
      return r.json();
    }).catch((e) => { registryPromise = null; throw e; });
    return registryPromise;
  }

  async function sha256Hex(buf) {
    if (!root.crypto || !root.crypto.subtle) return null;
    const d = new Uint8Array(await root.crypto.subtle.digest('SHA-256', buf));
    let s = ''; for (let i = 0; i < d.length; i++) s += d[i].toString(16).padStart(2, '0');
    return s;
  }

  async function fetchWithProgress(url, expected, onBytes, signal) {
    const res = await fetch(url, { signal, cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    const type = res.headers.get('content-type') || '';
    if (/text\/html/i.test(type)) throw new Error('Got an HTML page instead of a model: ' + url);   // SPA fallback page
    if (!res.body || !res.body.getReader) { const b = new Uint8Array(await res.arrayBuffer()); onBytes(b.length); return b; }
    const out = new Uint8Array(expected), reader = res.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > expected) throw new Error('Larger than expected (' + url + ')');
      out.set(value, got); got += value.length; onBytes(value.length);
    }
    if (got !== expected) throw new Error('Incomplete download ' + got + '/' + expected + ' bytes: ' + url);
    return out;
  }

  async function loadFile(reg, file, onBytes, signal) {
    const key = 'models/' + file.local + (file.sha256 ? '?sha=' + file.sha256.slice(0, 16) : '');
    let cache = null;
    try { cache = root.caches ? await root.caches.open(CACHE) : null; } catch (e) { cache = null; }
    if (cache) {
      const hit = await cache.match(key);
      if (hit) { const b = new Uint8Array(await hit.arrayBuffer()); if (b.length === file.bytes) { onBytes(file.bytes); return b; } await cache.delete(key); }
    }
    let lastErr = null, bytes = null, done = 0; const tried = [];
    for (const url of ['models/' + file.local, file.url || reg.release + file.file]) {
      try {
        done = 0;
        bytes = await fetchWithProgress(url, file.bytes, (n) => { done += n; onBytes(n); }, signal);
        break;
      } catch (e) { lastErr = e; tried.push(url + ': ' + e.message); onBytes(-done); if (signal && signal.aborted) throw e; }
    }
    if (!bytes) throw new Error('Could not load ' + file.local + ' (' + tried.join('; ') + ')');
    if (file.sha256) {
      const h = await sha256Hex(bytes);
      if (h && h !== file.sha256) throw new Error('Checksum mismatch for ' + file.local + ' (download corrupted)');
    }
    if (cache) { try { await cache.put(key, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { /* quota: still usable this session */ } }
    return bytes;
  }

  async function load(id, opts) {
    const o = opts || {}, reg = await registry(), entry = reg.models[id];
    if (!entry) throw new Error('Unknown model: ' + id);
    const total = entry.files.reduce((s, f) => s + f.bytes, 0);
    let have = 0;
    const bytes = {};
    for (const f of entry.files) {
      bytes[f.local] = await loadFile(reg, f, (n) => { have += n; if (o.onProgress) o.onProgress(Math.max(0, Math.min(1, have / total)), entry.title); }, o.signal);
    }
    return { bytes, entry, registryVersion: reg.version };
  }

  const api = { registry, load, CACHE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VS = root.VS || {};
  root.VS.ModelStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
