'use strict';
const assert = require('assert');
const { once } = require('events');
const WebSocket = require('ws');
const { createSignalingServer, safeName, validRoom } = require('./signaling-server');

(async () => {
  assert.strictEqual(validRoom('weekly-standup'), true);
  assert.strictEqual(validRoom('bad room'), false);
  assert.strictEqual(validRoom(''), false);
  assert.strictEqual(safeName('  Ada\u0000\nLovelace  '), 'Ada Lovelace');
  const serverSource = require('fs').readFileSync(require('path').join(__dirname, 'signaling-server.js'), 'utf8');
  assert(serverSource.includes('https://localhost') && serverSource.includes('capacitor://localhost'),
    'default CORS allowlist includes Capacitor WebView origins');
  assert.strictEqual(safeName('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>',
    'server preserves ordinary punctuation; client rendering must keep the name as text');

  const allowed = new Set(['https://studio.example.test']);
  const server = createSignalingServer({ port: 0, allowedOrigins: allowed });
  await once(server, 'listening');
  const url = 'ws://127.0.0.1:' + server.address().port;
  const openClient = async () => {
    const ws = new WebSocket(url, { origin: 'https://studio.example.test' });
    await once(ws, 'open');
    return ws;
  };
  const nextMessage = (ws) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket message timed out')), 3000);
    ws.once('message', (raw) => { clearTimeout(timer); resolve(JSON.parse(raw.toString())); });
  });

  const a = await openClient(), b = await openClient();
  try {
    a.send(JSON.stringify({ type: 'join', room: 'weekly-standup', name: '<b>Injected</b>' }));
    const joinedA = await nextMessage(a);
    assert.strictEqual(joinedA.type, 'joined');

    const aPeerJoined = nextMessage(a);
    b.send(JSON.stringify({ type: 'join', room: 'weekly-standup', name: 'Guest B' }));
    const joinedB = await nextMessage(b);
    assert.strictEqual(joinedB.type, 'joined');
    const notification = await aPeerJoined;
    assert.strictEqual(notification.type, 'peer-joined');
    assert.strictEqual(notification.name, 'Guest B');

    const received = nextMessage(b);
    a.send(JSON.stringify({ type: 'offer', to: joinedB.peerId, from: 'forged', sdp: 'test-sdp' }));
    const offer = await received;
    assert.strictEqual(offer.from, joinedA.peerId, 'server overwrites forged sender identity');
    assert.strictEqual(offer.sdp, 'test-sdp');

    const closed = once(a, 'close');
    a.send(JSON.stringify({ type: 'join', room: 'second-room', name: 'Again' }));
    const [code] = await closed;
    assert.strictEqual(code, 1008, 'a socket cannot join multiple rooms');
  } finally {
    a.terminate(); b.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('signaling-server: origin, room, membership and sender-integrity tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
