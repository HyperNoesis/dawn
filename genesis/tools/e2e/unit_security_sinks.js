'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const call = read('js/call.js');
const errors = read('js/error-boundary.js');
const app = read('js/app.js');
const environments = read('environments.html');
const editor = read('js/editor.js');

assert.match(call, /displayName\.textContent = String\(name/);
assert.doesNotMatch(call, /<div class="call-tile-label"><span>\$\{name\}<\/span>/);
assert.match(errors, /text\.textContent = 'Something went wrong:/);
assert.doesNotMatch(errors, /toast\.innerHTML/);
assert.doesNotMatch(app, /\$\{ov\.name\}|\$\{t\.name\}/, 'uploaded names and template names must never enter markup');
assert.match(app, /isEvalSupported:\s*false/);
assert.match(app, /pdfjs-dist@' \+ PDFJS_VERSION/);
assert.match(app, /MAX_PDF_PAGES = 40/);
assert.match(app, /MAX_PDF_TOTAL_PIXELS/);
assert.match(app, /MAX_IMAGE_TOTAL_PIXELS/);

assert(!app.includes('<div class="env-name">${env.name}</div>'),
  'Studio mini environment cards must not interpolate uploaded filenames');
assert(app.includes("card.querySelector('.env-name').textContent = String(env.name"),
  'Studio environment names are placed into the DOM as text');
assert(environments.includes('function spHtml(value)'),
  'environment gallery has an HTML escaping helper');
assert(!environments.includes('<div class="env-name">${env.name}</div>'),
  'environment gallery must not interpolate uploaded filenames raw');
assert(!editor.includes('${m.label}') && !editor.includes('${item.title}'),
  'user-authored marker labels and recording titles must never enter HTML');
assert(editor.includes('label.textContent = fmt(m.time)'),
  'marker label is rendered as text');
assert(editor.includes('title.textContent = String(i + 1)'),
  'sequence title is rendered as text');
assert(!editor.includes('clipSelect.innerHTML = recordings.map'),
  'clip picker options must not interpolate user-controlled titles');

console.log('security-sinks: untrusted strings, PDF resource caps and editor/environment paths are guarded');
