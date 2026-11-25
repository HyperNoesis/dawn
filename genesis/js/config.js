/**
 * App configuration.
 *
 * Leave both fields empty to keep using local-device-only accounts
 * (js/providers/auth-provider.js -> LocalAuthProvider) — nothing to set up,
 * works offline, no cost.
 *
 * Fill both in once you've created a Supabase project (see docs/DEPLOY.md)
 * to switch to real, cross-device accounts backed by Postgres + Supabase
 * Auth. No other file needs to change — this is the one switch.
 */
window.VS = window.VS || {};
window.VS.config = {
  // M5 business details. The Privacy and Terms pages fill these in; while any is empty they show a visible "not ready to publish" banner.
  business: { name: '', email: '', jurisdiction: 'Nigeria', effectiveDate: '', whatsapp: '' },
  // Optional hosted payment links (e.g. a Paystack payment page). Empty = the pricing buttons say "Join the pilot" instead.
  payLinks: { pro: '' },
  supabaseUrl: '',      // e.g. 'https://xxxxx.supabase.co'
  supabaseAnonKey: '',  // the "anon public" key from Project Settings > API

  // Live calling (call.html) needs a signaling server — see server/README.md
  // to deploy one (free options included). Leave empty and Live calling
  // stays visibly disabled rather than pretending to connect to nothing.
  signalingUrl: 'wss://genesis-signaling.onrender.com',

  // OPTIONAL experimental AI re-render of a RECORDED clip (server/render-relay.js, docs/LEVEL3_EXPERIMENT.md).
  // Empty = the button is hidden and nothing is ever uploaded. If set, the clip leaves the device only after the user confirms.
  // renderRelayToken is visible to every visitor (static site): use it only as a speed bump, rely on the relay's daily cap.
  renderRelayUrl: '',
  renderRelayToken: '',
  // Optional button text for the relay button (e.g. 'Studio Export: clean cutout on scene' when renderRelayUrl points at the gpu/ Studio Export service).
  renderRelayLabel: '',

  // Shared provider secrets must never be added to this public static file.
  // Groq accepts only a personal per-device key in localStorage.
  // Pollinations world generation uses its no-key public route.

};
