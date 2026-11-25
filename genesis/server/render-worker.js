'use strict';
/**
 * Self-hosted render worker. RENDER_CMD is trusted operator configuration;
 * no client value is ever interpolated into a shell command.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

function createWorker(cfg) {
  cfg = cfg || {};
  const cmdTemplate = String(cfg.cmd || '');
  const token = String(cfg.token || '');
  const maxBytes = Math.max(1, Number(cfg.maxMB) || 50) * 1048576;
  const maxOutputBytes = Math.max(1, Number(cfg.maxOutputMB) || 150) * 1048576;
  const timeoutMs = Math.max(1, Number(cfg.timeoutMin) || 30) * 60000;
  const ttlMs = Math.max(1, Number(cfg.ttlMin) || 60) * 60000;
  const maxJobs = Math.max(1, Number(cfg.maxJobs) || 25);
  if (!cmdTemplate) throw new Error('RENDER_CMD is required.');
  if (!token) throw new Error('WORKER_TOKEN is required; the render worker must not run unauthenticated.');

  const jobs = new Map();
  let running = null;
  const send = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  const removeFiles = (job) => {
    if (!job || !job.dir) return;
    try { fs.rmSync(job.dir, { recursive: true, force: true, maxRetries: 2 }); } catch (_) {}
  };
  const sweep = () => {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (now - job.createdAt > ttlMs && job !== running) {
        jobs.delete(id);
        removeFiles(job);
      }
    }
  };
  const authorized = (req) => {
    const value = String(req.headers.authorization || '');
    const expected = 'Bearer ' + token;
    const a = Buffer.from(value), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  function run(id) {
    const job = jobs.get(id);
    if (!job) return;
    running = job;
    job.status = 'running';
    const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
    const command = cmdTemplate
      .replace(/\{in\}/g, quote(job.inPath))
      .replace(/\{out\}/g, quote(job.outPath))
      .replace(/\{prompt\}/g, quote(job.promptPath));
    let ended = false;
    const finish = (ok, reason) => {
      if (ended) return;
      ended = true;
      clearTimeout(job.timer);
      running = null;
      if (!jobs.has(id)) {
        removeFiles(job);
        return;
      }
      if (ok && fs.existsSync(job.outPath)) {
        const size = fs.statSync(job.outPath).size;
        if (size > maxOutputBytes) {
          job.status = 'error';
          job.error = 'The rendered output exceeded the output-size limit.';
          removeFiles(job);
        } else {
          job.status = 'done';
          job.completedAt = Date.now();
        }
      } else {
        job.status = 'error';
        job.error = reason || 'The render command failed.';
        removeFiles(job);
      }
    };
    const child = spawn('sh', ['-c', command], { stdio: 'ignore', windowsHide: true });
    job.child = child;
    job.timer = setTimeout(() => {
      job.timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.once('error', () => finish(false, 'Could not start the render command.'));
    child.once('close', (code) => finish(code === 0 && !job.timedOut, job.timedOut ? 'The render timed out.' : 'The render command failed (exit ' + code + ').'));
  }

  const server = http.createServer((req, res) => {
    sweep();
    const url = new URL(req.url, 'http://worker.invalid');
    if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
    if (req.method === 'POST' && url.pathname === '/jobs') {
      if (running) return send(res, 429, { error: 'busy' });
      if (jobs.size >= maxJobs) return send(res, 429, { error: 'job capacity reached' });
      if (Number(req.headers['content-length'] || 0) > maxBytes) return send(res, 413, { error: 'too large' });
      let total = 0;
      const chunks = [];
      let finished = false;
      req.on('data', (chunk) => {
        if (finished) return;
        total += chunk.length;
        if (total > maxBytes) {
          finished = true;
          send(res, 413, { error: 'too large' });
          req.resume();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (finished) return;
        if (!chunks.length) return send(res, 400, { error: 'empty input' });
        let dir;
        try { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-render-')); }
        catch (_) { return send(res, 500, { error: 'could not create render workspace' }); }
        const id = crypto.randomBytes(16).toString('hex');
        const job = {
          id, status: 'queued', createdAt: Date.now(), dir,
          inPath: path.join(dir, 'input.clip'),
          outPath: path.join(dir, 'output.mp4'),
          promptPath: path.join(dir, 'prompt.txt'),
          error: null
        };
        try {
          fs.writeFileSync(job.inPath, Buffer.concat(chunks), { mode: 0o600 });
          fs.writeFileSync(job.promptPath, String(url.searchParams.get('prompt') || '').slice(0, 2000), { mode: 0o600 });
        } catch (_) {
          removeFiles(job);
          return send(res, 500, { error: 'could not store render input' });
        }
        jobs.set(id, job);
        run(id);
        return send(res, 202, { id });
      });
      req.on('error', () => { finished = true; chunks.length = 0; });
      return;
    }
    const match = url.pathname.match(/^\/jobs\/([a-f0-9]{32})(\/result)?$/);
    const job = match && jobs.get(match[1]);
    if (!job) return send(res, 404, { error: 'unknown job' });
    if (req.method === 'DELETE' && !match[2]) {
      if (job === running && job.child) job.child.kill('SIGTERM');
      jobs.delete(match[1]);
      if (job !== running) removeFiles(job);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && match[2]) {
      if (job.status !== 'done' || !fs.existsSync(job.outPath)) return send(res, 409, { error: 'not ready' });
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(job.outPath).pipe(res);
    }
    if (req.method === 'GET' && !match[2]) return send(res, 200, { status: job.status, error: job.error });
    return send(res, 405, { error: 'method not allowed' });
  });
  server._jobs = jobs;
  return server;
}
module.exports = { createWorker };

if (require.main === module) {
  const env = process.env;
  if (!env.RENDER_CMD || !env.WORKER_TOKEN) {
    console.error('Set RENDER_CMD and WORKER_TOKEN. Worker startup is blocked without both.');
    process.exit(2);
  }
  createWorker({
    cmd: env.RENDER_CMD, token: env.WORKER_TOKEN, maxMB: env.WORKER_MAX_MB,
    maxOutputMB: env.WORKER_MAX_OUTPUT_MB, timeoutMin: env.WORKER_TIMEOUT_MIN,
    ttlMin: env.WORKER_TTL_MIN, maxJobs: env.WORKER_MAX_JOBS
  }).listen(env.PORT || 8790, () => console.log('Genesis render worker ready'));
}
