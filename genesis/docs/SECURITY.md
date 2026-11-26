# Security & privacy — implementation status

## Account modes

Genesis selects its account provider from `js/config.js`:

- **Default/local mode** (the current checked-in configuration): guest state, local account metadata and sessions are stored in this browser profile. The local account implementation stores an unsalted SHA-256 password digest in `localStorage`. This is a device-local convenience gate, not server-grade authentication, and it is not suitable for protecting shared cloud resources.
- **Configured Supabase mode**: when both `supabaseUrl` and `supabaseAnonKey` are supplied, the app uses Supabase Auth and the Supabase storage provider. The anon key is public client configuration, not a service-role secret. The browser sends credentials to Supabase Auth over HTTPS; password hashing/storage is handled by Supabase, not by a pre-hash in this client. Cloud data security still depends on correct Supabase Auth settings, row-level security, Storage policies, database functions and project configuration.

Do not describe local accounts as verified identity, password recovery, or cross-device authentication. Local credentials can be read or modified by anyone with access to the browser profile or same-origin script execution. SHA-256 without a salt or a password-hardening KDF is not a secure password-storage design.

## Media and storage

- Camera processing and local segmentation run in the browser by default.
- Recordings and in-progress crash-recovery drafts use IndexedDB in local mode. Draft chunks remain local even when Supabase storage is configured.
- In configured Supabase mode, completed recordings saved through the active storage provider are uploaded to the configured Supabase Storage bucket and metadata is written to Postgres. This is cloud processing/storage and must be disclosed in the user experience and policy.
- Go Live sends the selected outgoing audio/video stream to the destination the user configures.
- Transcription sends the user-selected media to Groq using the user's own per-device API key. Environment generation sends the prompt to Pollinations.ai. Optional hosted re-rendering is disabled unless a relay URL is configured and requires an explicit user action/confirmation.

Never place service-role keys, JWT signing secrets, provider API keys, Android signing credentials or shared relay tokens in public frontend files. Only publish the Supabase anon key in the client; enforce all access with server-side policies.

## Release requirements

Before a public/paid release, verify:
- Supabase RLS and Storage policies against cross-user reads/writes and deletion.
- Local and cloud account wording, consent and retention against the deployed configuration.
- Cloud render job ownership, limits, expiry and cleanup.
- Signalling origin/rate/room controls and all disconnect paths.
- Upload byte/MIME/signature/dimension/duration limits and malformed-file handling.
- Account deletion removes owned Storage objects before account metadata and reports partial failures.
- Dependency, secret, unsafe DOM sink and package integrity scans on the exact release tree.

Protected signalling/render service tests and selected sink/storage unit tests exist, but passing those tests is not a substitute for a complete security audit or a review of live deployment configuration.
