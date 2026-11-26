# Privacy Policy

**[PLACEHOLDER: Effective date]**

This policy describes what Genesis does with your data. It's written to
match what the code actually does — not boilerplate. If a future feature
changes what leaves your device, this file must be updated in the same
change (see MASTER_ROADMAP.md's standing cleanup items).

Genesis is operated by **[PLACEHOLDER: legal entity / your name]**,
based in **[PLACEHOLDER: jurisdiction, e.g. Nigeria]**. Contact:
**[PLACEHOLDER: contact email]**.

## What stays on your device

- Your camera and microphone feed while using local Studio features. Background removal and compositing run in the browser by default; the live feed is sent to a destination only when you start a feature such as Go Live or a direct device-to-device call.
- In local mode, completed recordings, crash-recovery drafts, templates and brand-kit settings are stored in this browser's IndexedDB/local storage.
- In configured Supabase mode, completed recordings saved through the active cloud storage provider are uploaded to the configured Supabase Storage bucket and their metadata is stored in Postgres. In-progress crash-recovery drafts remain in local IndexedDB. The checked-in configuration currently leaves Supabase URL/key empty, so a deployment must be configured before cloud accounts/storage are active.

## What leaves your device, and when

- **Live streaming (Go Live):** your composited video/audio stream is
  sent to whatever WHIP ingest URL or RTMP relay you provide. You choose
  the destination; Genesis has no server in this path.
- **File transcription (Editor → Transcribe):** the audio/video file you
  choose to transcribe is sent directly to Groq's API using your own
  Groq API key, which is stored only in this browser's local storage.
  Never sent anywhere except Groq, and only when you transcribe.
- **AI environment generation (Create a world):** the text prompt you
  type is sent directly to Pollinations.ai to generate an image. No
  other data about you or your session is sent. Pollinations is a
  third-party, unmoderated API — see the Content Moderation note below.
- **Cloud accounts (optional, Supabase):** if the deployment has both a Supabase URL and public anon key configured, account creation/sign-in sends your email, password and supplied profile name to Supabase Auth over HTTPS. The browser does not pre-hash the password; Supabase Auth is responsible for credential hashing and storage. Cloud account and recording security depends on the deployed Auth, Postgres row-level security and Storage policies. The repository configuration is currently empty for Supabase, so this mode is not active in the checked-in configuration.
  Completed recordings saved while the Supabase storage provider is active are uploaded to Supabase Storage and their metadata is written to Postgres. In-progress crash-recovery drafts remain local.

- **Second phone as a camera, phone remote, live calls:** your phones set up a direct connection through a small relay (signalling) server that sees a random room code and the connection details (including network addresses) for a few seconds. The video itself goes phone to phone, not through the relay. To find a route, the browser asks a public Google STUN server, which sees your network address. If your network blocks direct connections these features will not connect (there is no TURN relay, so nothing is relayed through any server of ours).
- **Streaming health numbers:** the Go Live health line is calculated on your device from your own connection statistics; nothing is sent to us.
- **Noise removal, colour grades, LUTs, skin smoothing, trim:** all run on your device. A LUT file you load stays in this browser.
- **Payments:** no payment provider is configured in the checked-in `js/config.js` (`payLinks.pro` is empty). If a hosted payment link is configured in a deployment, payment details are handled on the provider's page; verify the provider integration and what Genesis receives before enabling it.

## What Genesis itself never collects

- No ad tracking, no analytics beyond what's explicitly listed above.
- No selling or sharing of your data with third parties beyond the
  services you directly invoke (Groq, Pollinations, your chosen
  streaming destination, or Supabase if configured).

## Your controls

- Local account/storage mode keeps saved recordings and drafts on this device by default. Features you explicitly invoke (such as Go Live, transcription, environment generation or direct calling) can still send the data described above to the selected destination/provider.
- In configured Supabase mode, account deletion first attempts to remove the signed-in user's objects from the `recordings` and `environments` Storage buckets, then calls the `delete_own_account` database function. If Storage cleanup fails, deletion stops and reports the error; if the database deletion fails after Storage cleanup, the app reports that partial state. Local-mode account deletion only removes that browser's local account/session and does not delete unrelated browser site data.
- You can clear local data any time via your browser's site data
  settings.

## Your rights (Nigeria Data Protection Act 2023)

You can ask to see, correct or delete the personal data held about you, withdraw consent, and object to some processing. Write to the contact email above. Genesis keeps as little as possible: with no account, nothing about you is held by us at all.

## Changes to this policy

**[PLACEHOLDER: how you'll notify users of changes — e.g. a dated
changelog on this page, or an in-app banner]**
