// Runs every *.test.js in this folder. model-store.test.js needs GENESIS_MODELS_DIR (it skips itself otherwise).
const { readdirSync } = require('fs'), { spawnSync } = require('child_process'), path = require('path');
let failed = 0;
for (const f of readdirSync(__dirname).filter((n) => n.endsWith('.test.js')).sort()) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  process.stdout.write((r.stdout || '') + (r.stderr || ''));
  if (r.status !== 0) { failed++; console.log('FAILED: ' + f); }
}
console.log(failed ? failed + ' test file(s) failed' : 'all unit tests passed');
process.exit(failed ? 1 : 0);
