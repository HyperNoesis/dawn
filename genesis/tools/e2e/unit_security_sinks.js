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
assert(call.includes('function stopCallMedia()'), 'Live Call exposes one media cleanup path');
assert(call.includes("ws.addEventListener('close', () => {\n      stopCallMedia();"),
  'Live Call disconnect stops all camera and microphone tracks');
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

const environmentProvider = read('js/providers/environment-provider.js');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const audio = read('js/audio-studio.js');
const show = read('js/show.js');
const capacitor = read('capacitor.config.json');
assert(app.includes('file.size > 20 * 1024 * 1024'), 'Studio background uploads enforce a byte limit');
assert(environments.includes('file.size > 20 * 1024 * 1024'), 'environment gallery uploads enforce a byte limit');
assert(app.includes('file.size > 5 * 1024 * 1024'), 'brand logo uploads enforce a byte limit');
assert(environmentProvider.includes('sourceWidth * sourceHeight > 24000000'), 'shared image persistence enforces a decoded-pixel limit');

assert(manifest.includes('android:allowBackup="false"'), 'Android backups must not silently copy local recordings');
assert(!capacitor.includes('"url": "https://hypernoesis.github.io'), 'Android must load bundled web assets instead of trusting remote app code');

const config = read('js/config.js');
const transcription = read('js/providers/groq-transcription.js');
assert(!config.includes('groqApiKey:'), 'shared Groq keys must not be bundled in public config');
assert(!config.includes('pollinationsApiKey:'), 'shared Pollinations keys must not be bundled in public config');
assert(!config.includes('renderRelayToken:'), 'shared relay tokens must not be bundled in public config');
assert(!transcription.includes('config.groqApiKey'), 'transcription must not read a shared config secret');
assert(app.includes('const params = `width=1280&height=720&seed=${seed}`'),
  'Pollinations remains on the no-key public route');

assert(!audio.includes('clipSelect.innerHTML = recordings.map'), 'Audio recording titles are not interpolated into options');
assert(audio.includes('option.textContent = clipTitle(recording)'), 'Audio recording title uses textContent');
assert(!show.includes("sel.innerHTML = '<option value=\"\">Leave as it is</option>'"),
  'Show look and preset labels are not interpolated into options');
assert(show.includes('option.textContent = String(item[1]'), 'Show option labels use textContent');

console.log('security-sinks: user-content, PDF/media limits, native privacy and client-secret boundaries are guarded');
