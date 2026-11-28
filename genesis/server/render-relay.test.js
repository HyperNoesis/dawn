'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { createRelay } = require('./render-relay');

function tokenFor(secret, sub, overrides = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode(Object.assign({
    sub,
    aud: 'authenticated',
    role: 'authenticated',
    iss: 'https://project.example.supabase.co/auth/v1',
    exp: Math.floor(Date.now() / 1000) + 3600
  }, overrides));
  const signature = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + signature;
}

(async () => {
  const secret = 'test-only-signing-secret-that-is-not-for-production';
  const submissions = [];
  const deleted = [];
  const provider = {
    id: 'fixture',
    async submit() { const upstreamId = 'up-' + (submissions.length + 1); submissions.push(upstreamId); return { upstreamId }; },
    async poll() { return { status: 'running' }; },
    async delete(id) { deleted.push(id); }
  };
  const server = createRelay({
    provider, supabaseJwtSecret: secret, supabaseUrl: 'https://project.example.supabase.co',
    allowOrigin: 'https://studio.example.test', dailyCap: 3, maxActive: 3, maxActivePerUser: 1
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const userA = '00000000-0000-4000-8000-000000000001';
  const userB = '00000000-0000-4000-8000-000000000002';
  const bearer = (sub, extra) => ({ Authorization: 'Bearer ' + tokenFor(secret, sub, extra) });
  const postJob = (headers) => fetch(base + '/render/jobs', {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'video/mp4' }, headers), body: Buffer.from('clip')
  });
  try {
    assert.strictEqual((await fetch(base + '/render/health')).status, 200);
    assert.strictEqual((await postJob({})).status, 401, 'anonymous callers are rejected');
    assert.strictEqual((await postJob(bearer(userA, { aud: 'anon' }))).status, 401, 'anon JWTs are rejected');
    assert.strictEqual((await postJob(bearer(userA, { role: 'service_role' }))).status, 401, 'service-role claims are not accepted as users');

    const first = await postJob(bearer(userA));
    assert.strictEqual(first.status, 202);
    const firstId = (await first.json()).jobId;
    assert.strictEqual((await postJob(bearer(userA))).status, 429, 'one active job per user is enforced');
    assert.strictEqual((await fetch(base + '/render/jobs/' + firstId, { headers: bearer(userB) })).status, 404,
      'another user cannot enumerate or poll a job');
    assert.strictEqual((await fetch(base + '/render/jobs/' + firstId, { headers: bearer(userA) })).status, 200);
    assert.strictEqual((await fetch(base + '/render/jobs/' + firstId, { method: 'DELETE', headers: bearer(userA) })).status, 200);
    assert.deepStrictEqual(deleted, ['up-1'], 'cancel releases the upstream job');
    assert.strictEqual((await fetch(base + '/render/jobs/' + firstId, { headers: bearer(userA) })).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('render-relay: signed identity, ownership and job-limit tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
