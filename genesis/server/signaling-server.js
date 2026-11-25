'use strict';
// Bounded WebSocket signalling relay for Genesis calls and companion devices.
// The server forwards structured signalling messages only; media stays peer-to-peer.
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8787);
const MAX_PEERS_PER_ROOM = 6;
const MAX_ROOMS = 2000;
const MAX_CONNECTIONS = 4000;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_MESSAGES_PER_WINDOW = 60;
const RATE_WINDOW_MS = 10_000;
const ROOM_RE = /^[A-Za-z0-9_-]{6,64}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const defaultOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS || 'https://hypernoesis.github.io')
    .split(',').map((value) => value.trim()).filter(Boolean)
);
const rooms = new Map();
const sockets = new Set();
let nextPeerId = 1;

function safeName(value) {
  if (typeof value !== 'string') return 'Guest';
  const clean = value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return clean || 'Guest';
}
function validRoom(value) {
  return typeof value === 'string' && ROOM_RE.test(value);
}
function send(ws, message) {
  if (ws.readyState === ws.OPEN && ws.bufferedAmount < MAX_MESSAGE_BYTES * 4) ws.send(JSON.stringify(message));
}
function broadcast(room, fromId, message) {
  for (const [peerId, peer] of room) if (peerId !== fromId) send(peer.ws, message);
}
function removeMembership(state) {
  if (!state.room || !state.peerId) return;
  const room = rooms.get(state.room);
  if (room) {
    room.delete(state.peerId);
    broadcast(room, state.peerId, { type: 'peer-left', peerId: state.peerId });
    if (room.size === 0) rooms.delete(state.room);
  }
  state.room = null;
  state.peerId = null;
}

function createSignalingServer(options = {}) {
  const origins = options.allowedOrigins || defaultOrigins;
  const wss = new WebSocketServer({
    port: options.port || PORT,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
    clientTracking: true,
    verifyClient: (info, done) => {
      const origin = info.origin;
      if (!origin || !origins.has(origin)) return done(false, 403, 'Origin not allowed');
      return done(true);
    }
  });

  wss.on('connection', (ws) => {
    if (sockets.size >= MAX_CONNECTIONS) {
      ws.close(1013, 'Server is busy');
      return;
    }
    const state = { room: null, peerId: null, messages: 0, windowStart: Date.now(), closed: false };
    sockets.add(ws);

    ws.on('message', (raw) => {
      if (state.closed) return;
      const now = Date.now();
      if (now - state.windowStart > RATE_WINDOW_MS) {
        state.windowStart = now;
        state.messages = 0;
      }
      if (++state.messages > MAX_MESSAGES_PER_WINDOW) {
        ws.close(1008, 'Message rate limit exceeded');
        return;
      }
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch (_) { ws.close(1007, 'Invalid JSON'); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message) ||
          typeof message.type !== 'string' || message.type.length > 48) {
        ws.close(1008, 'Invalid message');
        return;
      }

      if (message.type === 'join') {
        if (state.room || state.peerId) {
          ws.close(1008, 'A socket may join only one room');
          return;
        }
        if (!validRoom(message.room)) {
          ws.close(1008, 'Invalid room code');
          return;
        }
        if (rooms.size >= MAX_ROOMS && !rooms.has(message.room)) {
          ws.close(1013, 'Too many active rooms');
          return;
        }
        const room = rooms.get(message.room) || new Map();
        if (room.size >= MAX_PEERS_PER_ROOM) {
          send(ws, { type: 'room-full', max: MAX_PEERS_PER_ROOM });
          return;
        }
        const peerId = 'p' + (nextPeerId++);
        const name = safeName(message.name);
        const existingPeers = Array.from(room.entries()).map(([id, peer]) => ({ id, name: peer.name }));
        state.room = message.room;
        state.peerId = peerId;
        room.set(peerId, { ws, name });
        rooms.set(message.room, room);
        send(ws, { type: 'joined', peerId, existingPeers });
        broadcast(room, peerId, { type: 'peer-joined', peerId, name });
        return;
      }

      if (!state.room || !state.peerId) return;
      const room = rooms.get(state.room);
      if (!room) {
        removeMembership(state);
        ws.close(1011, 'Room state expired');
        return;
      }
      if (typeof message.to !== 'string' || message.to.length > 32) return;
      const target = room.get(message.to);
      if (!target || target.ws === ws) return;
      const forwarded = Object.assign({}, message, { from: state.peerId });
      delete forwarded.peerId;
      delete forwarded.name;
      send(target.ws, forwarded);
    });

    ws.on('close', () => {
      state.closed = true;
      sockets.delete(ws);
      removeMembership(state);
    });
    ws.on('error', () => {
      state.closed = true;
      sockets.delete(ws);
      removeMembership(state);
    });
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}

if (require.main === module) {
  const server = createSignalingServer();
  server.on('listening', () => console.log('Genesis signalling server listening on port ' + PORT));
}
module.exports = { createSignalingServer, safeName, validRoom };
