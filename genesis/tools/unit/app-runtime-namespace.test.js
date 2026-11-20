'use strict';

// Regression guard for the live segmentation upgrade path: app.js uses the shared
// VS namespace from multiple async functions. It must be bound in the outer app
// bootstrap, not only inside selected helpers.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '../../js/app.js');
const source = fs.readFileSync(appPath, 'utf8');

assert.match(source, /^\(async function \(\) \{/, 'app.js should retain its async bootstrap');
assert.match(
  source,
  /^\(async function \(\) \{[\s\S]{0,500}\bconst V = window\.VS;/,
  'the app bootstrap must bind V before async engine-upgrade code can use it'
);

// Parse the complete application source without executing browser-dependent code.
assert.doesNotThrow(() => new Function(source), 'app.js must remain syntactically valid');

console.log('app-runtime-namespace: all assertions passed');
