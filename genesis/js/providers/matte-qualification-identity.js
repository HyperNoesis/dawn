/* Canonical, fail-closed identity for a segmentation pipeline.
 * Hashes actual loaded model bytes and the exact same-origin processing/runtime
 * resources. A missing crypto primitive or unavailable resource prevents
 * qualification; it never invents a stable identity.
 */
(function (root) {
  'use strict';

  const resourceCache = new Map();

  function subtleCrypto() {
    if (root.crypto && root.crypto.subtle) return root.crypto.subtle;
    if (typeof require === 'function') {
      try {
        const nodeCrypto = require('crypto');
        if (nodeCrypto.webcrypto && nodeCrypto.webcrypto.subtle) return nodeCrypto.webcrypto.subtle;
      } catch (e) {}
    }
    throw new Error('Web Crypto SHA-256 is unavailable; exact pipeline identity cannot be established.');
  }

  function bytesOf(value) {
    if (typeof value === 'string') {
      const Encoder = root.TextEncoder || (typeof TextEncoder !== 'undefined' ? TextEncoder : null);
      if (!Encoder) throw new Error('TextEncoder is unavailable.');
      return new Encoder().encode(value);
    }
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new Error('Pipeline identity received a non-binary asset.');
  }

  function stable(value) {
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Pipeline identity configuration contains a non-finite number.');
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
    }
    throw new Error('Pipeline identity configuration contains an unsupported value.');
  }

  async function sha256Hex(value) {
    const bytes = bytesOf(value);
    const digest = await subtleCrypto().digest('SHA-256', bytes);
    const view = new Uint8Array(digest);
    let out = '';
    for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0');
    return out;
  }

  async function hashModelFiles(files) {
    if (!files || typeof files !== 'object') throw new Error('Loaded model files are missing.');
    const names = Object.keys(files).sort();
    if (!names.length) throw new Error('Loaded model file set is empty.');
    const entries = [];
    for (const name of names) {
      if (!name || !files[name]) throw new Error('Loaded model file is missing: ' + name);
      const bytes = bytesOf(files[name]);
      entries.push({ name, bytes: bytes.byteLength, sha256: await sha256Hex(bytes) });
    }
    return sha256Hex(stable({ schema: 'genesis-model-assets-v1', files: entries }));
  }

  async function resourceDigests(paths) {
    const unique = Array.from(new Set(paths || [])).sort();
    const fetcher = root.fetch || (typeof fetch === 'function' ? fetch : null);
    if (unique.length && !fetcher) throw new Error('Fetch is unavailable; pipeline source identity cannot be established.');
    const entries = [];
    for (const path of unique) {
      if (typeof path !== 'string' || !path || path.indexOf('://') !== -1) throw new Error('Pipeline identity resource must be a same-origin relative path.');
      let pending = resourceCache.get(path);
      if (!pending) {
        pending = (async () => {
          const response = await fetcher(path, { cache: 'no-cache', credentials: 'same-origin' });
          if (!response || !response.ok) throw new Error('Could not read pipeline identity resource: ' + path + ' (HTTP ' + (response && response.status) + ')');
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (!bytes.byteLength) throw new Error('Pipeline identity resource is empty: ' + path);
          return { path, bytes: bytes.byteLength, sha256: await sha256Hex(bytes) };
        })();
        resourceCache.set(path, pending);
        pending.catch(() => resourceCache.delete(path));
      }
      entries.push(await pending);
    }
    return entries;
  }

  async function stageHash(paths, config) {
    const resources = await resourceDigests(paths || []);
    return sha256Hex(stable({ schema: 'genesis-pipeline-stage-v1', resources, config: config || {} }));
  }

  async function runtimeDescriptor(runtime) {
    if (!runtime || typeof runtime !== 'object' || !runtime.backend) throw new Error('Runtime backend identity is incomplete.');
    const fingerprint = await stageHash(runtime.resources || [], runtime.config || {});
    return String(runtime.name || 'runtime') + ';backend=' + String(runtime.backend) + ';sha256=' + fingerprint;
  }

  function validHash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }

  async function create(options) {
    const o = options || {};
    if (typeof o.modelVersion !== 'string' || !o.modelVersion.trim()) throw new Error('Model version is missing from pipeline identity.');
    const modelSha256 = o.modelSha256 || await hashModelFiles(o.modelFiles);
    if (!validHash(modelSha256)) throw new Error('Exact model asset SHA-256 is unavailable.');
    const preprocessHash = await stageHash(o.preprocessResources || [], o.preprocessConfig || {});
    const postprocessHash = await stageHash(o.postprocessResources || [], o.postprocessConfig || {});
    const runtimeBackend = await runtimeDescriptor(o.runtime);
    return Object.freeze({
      modelVersion: o.modelVersion,
      modelSha256,
      preprocessHash,
      postprocessHash,
      runtimeBackend
    });
  }

  async function extend(parent, options) {
    const o = options || {};
    if (!parent || !validHash(parent.modelSha256) || !validHash(parent.preprocessHash) ||
        !validHash(parent.postprocessHash) || typeof parent.modelVersion !== 'string' ||
        typeof parent.runtimeBackend !== 'string' || !parent.runtimeBackend) {
      throw new Error('The parent provider has no complete canonical qualification identity.');
    }
    const extensionModel = o.modelSha256 || (o.modelFiles ? await hashModelFiles(o.modelFiles) : null);
    if (extensionModel && !validHash(extensionModel)) throw new Error('Extension model asset SHA-256 is unavailable.');
    const modelSha256 = extensionModel
      ? await sha256Hex(stable({ schema: 'genesis-composed-model-v1', parent: parent.modelSha256, extension: extensionModel }))
      : parent.modelSha256;
    const preprocessExtension = await stageHash(o.preprocessResources || [], o.preprocessConfig || {});
    const postprocessExtension = await stageHash(o.postprocessResources || [], o.postprocessConfig || {});
    const preprocessHash = await sha256Hex(stable({ schema: 'genesis-composed-stage-v1', parent: parent.preprocessHash, extension: preprocessExtension }));
    const postprocessHash = await sha256Hex(stable({ schema: 'genesis-composed-stage-v1', parent: parent.postprocessHash, extension: postprocessExtension }));
    const runtimeBackend = o.runtime
      ? parent.runtimeBackend + '|' + await runtimeDescriptor(o.runtime)
      : parent.runtimeBackend;
    return Object.freeze({
      modelVersion: parent.modelVersion + String(o.modelVersionSuffix || ''),
      modelSha256,
      preprocessHash,
      postprocessHash,
      runtimeBackend
    });
  }

  const api = { sha256Hex, hashModelFiles, resourceDigests, stageHash, runtimeDescriptor, create, extend, validHash };
  root.VS = root.VS || {};
  root.VS.MatteQualificationIdentity = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
