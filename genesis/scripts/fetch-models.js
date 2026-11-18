#!/usr/bin/env node
/**
 * Download pretrained weights listed in models/registry.json, verify SHA-256, resume partial files.
 * Zero dependencies (Node 18+).
 *
 *   node scripts/fetch-models.js                 # the browser set: birefnet-lite + edgetam + ppmatting-v2   (into models/)
 *   node scripts/fetch-models.js --only ppmatting-hrnet   # PP-Matting HRNet-W18 (export quality, ~94 MiB)
 *   node scripts/fetch-models.js --all           # every entry, including GPU-server weights
 *   node scripts/fetch-models.js --only edgetam,birefnet-lite
 *   node scripts/fetch-models.js --list          # show entries, sizes, licences, what is already on disk
 *   node scripts/fetch-models.js --dest www/models --check   # verify only, download nothing
 *
 * A file whose registry sha256 is null is downloaded but reported as UNVERIFIED.
 * Exit code is 1 if any file failed or did not match its hash.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'models', 'registry.json'), 'utf8'));
const DEFAULT_SET = ['birefnet-lite', 'edgetam', 'ppmatting-v2'];   // v0.94: + PP-MattingV2 (live matting beta, ~34 MiB). 'ppmatting-hrnet' (~94 MiB, export quality) is opt-in: --only ppmatting-hrnet

function parseArgs(argv) {
  const a = { all: false, only: null, list: false, check: false, dest: path.join(ROOT, 'models'), retries: 3 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--all') a.all = true;
    else if (k === '--list') a.list = true;
    else if (k === '--check') a.check = true;
    else if (k === '--only') a.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--dest') a.dest = path.resolve(argv[++i] || '');
    else if (k === '--retries') a.retries = Math.max(1, parseInt(argv[++i], 10) || 3);
    else if (k === '-h' || k === '--help') { a.help = true; }
    else throw new Error('Unknown option: ' + k);
  }
  return a;
}

function human(n) { return n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : (n / 1e3).toFixed(0) + ' KB'; }

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** Status of one registry file on disk: 'ok' | 'unverified' | 'missing' | 'partial' | 'bad'. */
async function status(file, dest) {
  const p = path.join(dest, file.local);
  if (!fs.existsSync(p)) return 'missing';
  const size = fs.statSync(p).size;
  if (size < file.bytes) return 'partial';
  if (size > file.bytes) return 'bad';
  if (!file.sha256) return 'unverified';
  return (await sha256File(p)) === file.sha256 ? 'ok' : 'bad';
}

/** Download with Range resume. Follows redirects (GitHub release assets redirect to a CDN). */
async function download(url, out, expectedBytes, label) {
  const part = out + '.part';
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (have > expectedBytes) { fs.unlinkSync(part); have = 0; }
  const res = await fetch(url, { redirect: 'follow', headers: have ? { Range: 'bytes=' + have + '-' } : {} });
  if (res.status === 416) { have = 0; fs.unlinkSync(part); return download(url, out, expectedBytes, label); }
  if (!res.ok && res.status !== 206) throw new Error('HTTP ' + res.status + ' for ' + url);
  if (res.status === 200 && have) { fs.unlinkSync(part); have = 0; }   // server ignored Range: start over
  const ws = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
  let got = have, lastPrint = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!ws.write(value)) await new Promise((r) => ws.once('drain', r));
    got += value.length;
    const now = Date.now();
    if (process.stdout.isTTY && now - lastPrint > 400) {
      lastPrint = now;
      process.stdout.write('\r  ' + label + '  ' + Math.round((got / expectedBytes) * 100) + '%  (' + human(got) + ')   ');
    }
  }
  await new Promise((r, j) => ws.end((e) => (e ? j(e) : r())));
  if (process.stdout.isTTY) process.stdout.write('\r' + ' '.repeat(70) + '\r');
  fs.renameSync(part, out);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*|^ \* ?/gm, '')); return 0; }
  const ids = args.only || (args.all ? Object.keys(REG.models) : DEFAULT_SET);
  for (const id of ids) if (!REG.models[id]) throw new Error('Unknown model id: ' + id + '. Known: ' + Object.keys(REG.models).join(', '));
  fs.mkdirSync(args.dest, { recursive: true });

  if (args.list) {
    for (const [id, m] of Object.entries(REG.models)) {
      const total = m.files.reduce((s, f) => s + f.bytes, 0);
      const st = [];
      for (const f of m.files) st.push(await status(f, args.dest));
      const disk = m.files.length ? (st.every((s) => s === 'ok' || s === 'unverified') ? 'on disk' : 'not on disk') : 'bundled';
      console.log(id.padEnd(26) + human(total).padStart(9) + '  ' + (m.commercial ? 'commercial-ok ' : 'NON-COMMERCIAL') + '  ' + m.licence + '  [' + disk + ']');
    }
    return 0;
  }

  let failed = 0, unverified = 0;
  for (const id of ids) {
    const m = REG.models[id];
    console.log('\n' + id + ' - ' + m.title + '  (' + m.licence + ')');
    for (const f of m.files) {
      const out = path.join(args.dest, f.local);
      let st = await status(f, args.dest);
      if (st === 'ok') { console.log('  ok        ' + f.local); continue; }
      if (st === 'unverified') { console.log('  UNVERIFIED ' + f.local + ' (no published hash)'); unverified++; continue; }
      if (args.check) { console.log('  ' + st.toUpperCase().padEnd(9) + ' ' + f.local); failed++; continue; }
      if (st === 'bad') fs.unlinkSync(out);
      let lastErr = null;
      for (let t = 1; t <= args.retries; t++) {
        try { await download(f.url || REG.release + f.file, out, f.bytes, f.local); lastErr = null; break; }
        catch (e) { lastErr = e; console.log('  retry ' + t + '/' + args.retries + ' ' + f.local + ': ' + e.message); }
      }
      if (lastErr) { console.log('  FAILED    ' + f.local); failed++; continue; }
      st = await status(f, args.dest);
      if (st === 'ok') console.log('  downloaded ' + f.local + '  ' + human(f.bytes) + '  sha256 verified');
      else if (st === 'unverified') { console.log('  downloaded ' + f.local + '  ' + human(f.bytes) + '  UNVERIFIED (no published hash)'); unverified++; }
      else { console.log('  BAD HASH  ' + f.local + ' (deleted)'); try { fs.unlinkSync(out); } catch (e) { /* ignore */ } failed++; }
    }
    if (!m.commercial) console.log('  note: ' + m.licence + '. Fine for your own measuring; check the terms before a paid product.');
  }
  console.log('\n' + (failed ? failed + ' file(s) failed.' : 'All requested files present and verified.') + (unverified ? ' ' + unverified + ' without a published hash.' : ''));
  return failed ? 1 : 0;
}

if (require.main === module) main().then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
module.exports = { status, sha256File, parseArgs, DEFAULT_SET };
