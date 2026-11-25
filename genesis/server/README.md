# Genesis signalling and render services

## Signalling

The WebSocket relay carries only room membership and WebRTC signalling. Audio/video
media remains peer-to-peer. It enforces a six-peer room limit, bounded message
payloads, per-connection rate limits, a global connection/room cap, one-room-per-
socket membership and heartbeat cleanup.

Configure the browser origins that may connect:

```sh
ALLOWED_ORIGINS=https://hypernoesis.github.io,https://your-custom-domain.example
```

The default is the GitHub Pages origin. Local testing must explicitly allow the
local origin, for example `ALLOWED_ORIGINS=http://localhost:8080`. Do not use a
wildcard origin for a public signalling server. The app validates room codes and
the server strips control characters and caps participant display names.

Run it with:

```sh
npm install
ALLOWED_ORIGINS=https://hypernoesis.github.io npm start
```

The server has no TURN relay. Some restrictive networks will still fail to
establish a peer connection; a production calling service needs a managed TURN
provider or an SFU such as LiveKit. The current pure-mesh design is not suitable
for large meetings.

## Hosted render relay

The optional relay accepts recorded clips only. It does not receive the live
camera stream. Its endpoints require a verified Supabase user access token;
the Supabase JWT signing secret is server-side only and must never be placed in
`js/config.js`.

Required environment:
- `SUPABASE_URL`
- `SUPABASE_JWT_SECRET`
- `ALLOW_ORIGIN` (the exact deployed Studio origin)
- `RENDER_PROVIDER` and the selected provider's server-side API key/URL

Optional limits:
- `RELAY_MAX_MB` (default 20)
- `RELAY_DAILY_CAP` (default 10 jobs per user/day)
- `RELAY_MAX_ACTIVE` (default 2 total)
- `RELAY_MAX_ACTIVE_PER_USER` (default 1)
- `RELAY_TTL_MIN` (default 60)

If JWT verification is not configured, hosted rendering is disabled. Local-only
and guest accounts cannot call the hosted relay. Each job is bound to the
authenticated Supabase user; one user cannot inspect, download or cancel
another user's job.

For a worker provider, also set `RENDER_WORKER_URL` and `WORKER_TOKEN`.
The worker refuses to start without its server-side token, caps input/output
size and job count, and deletes temporary workspaces after completion or expiry.
Do not expose the worker directly to browsers.

The relay itself keeps incoming clips in memory while forwarding them. A
self-hosted worker necessarily writes its temporary working files to disk and
removes them after completion, cancellation or expiry. Review the selected
upstream provider's own retention policy before enabling it for customer clips.
