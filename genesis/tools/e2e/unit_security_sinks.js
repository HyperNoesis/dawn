'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const call = read('js/call.js');
const errors = read('js/error-boundary.js');
const app = read('js/app.js');

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

console.log('security-sinks: untrusted display strings and PDF resource caps are guarded');
