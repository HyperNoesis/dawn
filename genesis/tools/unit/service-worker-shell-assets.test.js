'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const studio = fs.readFileSync(path.join(root, 'studio.html'), 'utf8');
const block = sw.match(/const SHELL_ASSETS\s*=\s*\[([\s\S]*?)\];/);
assert.ok(block, 'service worker must declare a shell asset manifest');
const assets = new Set([...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

for (const file of fs.readdirSync(path.join(root, 'js/providers')).filter((name) => name.endsWith('.js'))) {
  const asset = 'js/providers/' + file;
  assert.ok(assets.has(asset), 'provider module must be precached for offline Studio: ' + asset);
}

const localRefs = [];
for (const match of studio.matchAll(/<(script|link)\b[^>]*>/gi)) {
  const tag = match[0];
  const attr = match[1].toLowerCase() === 'script' ? 'src' : 'href';
  const value = tag.match(new RegExp('\\b' + attr + '\\s*=\\s*["\\']([^"\\']+)["\\']', 'i'))?.[1];
  if (!value || /^(?:https?:|data:|#|\/\/)/i.test(value)) continue;
  localRefs.push(value.replace(/^\//, '').split('?')[0]);
}
for (const ref of localRefs) {
  assert.ok(assets.has(ref), 'Studio shell dependency must be precached: ' + ref);
}
assert.match(sw, /genesis-shell-v147/,
  'changing the shell asset manifest must bump the shell cache version');

console.log('service-worker-shell-assets: all provider and Studio document dependencies are precached');
