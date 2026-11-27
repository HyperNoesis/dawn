# Handoff for the next AI (written 27 Nov 2026). Read this first, then ask the owner only what is not here.

## Who and what
- Owner: solo founder in Nigeria (brand: Rejuvini Tech). Works from an Android phone (Redmi), often on a free Claude plan: keep replies short and fast. Wants premium, human-sounding copy: no AI-sounding sentences, short punchy words.
- Product: **Genesis Studio**, a browser PWA virtual studio (cutout, scenes, recording, broadcast tools). Code: GitHub `HyperNoesis/dawn`, folder `genesis/`.
- Test site (Render, static): https://genesis-ultramatte-test.onrender.com . Render service `genesis-ultramatte-test` (id srv-dc1n6g56e07s73dqs0d0) auto-deploys branch `segmentation/adaptive-ultramatte-default`. Work branch: `claude/final-studio-segmentation`. Keep BOTH branches at the same commit (push HEAD to both). The Render workspace is at the Hobby limit of 25 services: reuse, do not create.
- Owner is presenting to thousands of people (his mentor's community, Edpassare). The first impression must feel premium. He was asked to send a "my journey" copy by morning 28 Nov and later sell to parents. Studio is NOT ready, so the landing page says "Coming soon".

## Done in this session
1. Segmentation: real-photo test (12 P3M portraits) found UltraMatte returned empty mattes; fixed (error 148.7 -> 10.3, best engine). Report: `GENESIS_SEGMENTATION_QUALIFICATION.md`. Registry still says "experimental": no engine is approved (no phone, no video).
2. v1.01 (`CHANGELOG-v1_01-ultramatte-default.md`): flag `ultraDefault` in `flags.json` makes UltraMatte the default and locks the quality governor to it (only picture size steps down 512>320, never another engine). Unit test `tools/unit/ultra-lock.test.js`. NOT yet checked on a real phone; UltraMatte measured ~1.3 mask updates/s on desktop software rendering, so phone lag is the top risk. Fallback plan: Fast/Quality switch or lower size floor.
3. UI trim: studio start screen shows only the "Start Camera" button (no titles, no explainer, no "browse environments" link). Appearance panel last line is now "Appearance and density change the interface."
4. Landing page: every link to `studio.html` opens a "Coming soon" dialog with "Join the early list". One switch to reopen: `studioOpen: true` in `js/config.js`.

## Still to do (in order)
1. Owner fills `js/config.js` business: name, email, whatsapp (234...), so the early-list form works and Privacy/Terms banners go away. Ask him for these.
2. Phone test by owner on the Render URL: Diagnostics > "Test effects speed", then report lag/flicker. Fix lag if needed.
3. Premium visual pass on landing page + studio (see "Design direction" below). Owner is choosing a palette/template.
4. Bump the service-worker cache (`sw.js`, genesis-shell-v147 -> v148) when shipping UI changes so installed phones refresh.
5. Before-after pictures in `assets/landing/`, check scene-image licence (Grok Imagine, unrecorded), lawyer read of Terms before charging.
6. Open a PR (none exists, CI has not run on this branch).

## Design direction (research summary)
- Waitlist pages convert on: a specific outcome headline, ONE clear call to action above the fold, a short founder story, real proof (a real clip beats claims), no extra navigation, and a confirmation step. Mobile first. Calm, uncluttered pages feel more premium. Dark UI reads premium; blue reads trust.
- Copy rule from owner: no AI-sounding sentences. Short, concrete, human.

## Practical notes
- The GitHub connector in chat is read-only. Pushing needs a short-lived fine-grained token from the owner (Contents: read/write on dawn only). Never store tokens. Tell him to delete it after.
- Unit tests: `node genesis/tools/unit/run-all.js` (all pass at commit 191914f). Browser e2e needs Chromium (tools/e2e).
- Do not commit the P3M test photos (research-only licence).
- Never claim an engine is "approved" or the product "ready" without phone evidence.
