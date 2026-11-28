# Genesis Atelier v2.1: acceptance evidence (28 Nov 2026)

Status per spec §32. "Verified" = measured here with a headless Chrome and the synthetic camera. Nothing here is real-device or real-user evidence.

| Item | Status | Evidence / gap |
|---|---|---|
| Atelier dark and light tokens explicit | Verified | `css/genesis-system.css` Atelier block; screenshots dark and light |
| Applied before first paint, no blue flash | Verified | `js/theme-boot.js` in `<head>` of all 19 pages |
| Brand and accent split; saved accents win | Verified | champagne default; violet/cyan/blue/rose/emerald/amber still selectable; storage key `genesis.appearance.v1` unchanged |
| Contrast, 9 pages x dark/light x 7 accents | Partially verified | Primary buttons, skip link fixed. Open: step numbers on violet/blue accents; light-mode scene-label text over images (audit cannot see images) |
| Real Genesis logo kept | Verified | no logo changed (orb gradient recoloured only) |
| Hero uses own approved photo | Done (owner-supplied, 28 Nov) | `assets/hero/`, responsive webp, fetchpriority high, set dimensions. Real product screenshot still missing; consent/rights for the image are the owner's to confirm |
| Headline "Great video. Made easy." | Done as a candidate, not validated | needs user testing |
| Unsupported claims removed (Free to try, no account) | Verified | landing.html |
| First-use Studio: only "Start your camera" | Verified | overlay hides title, paragraph, env link |
| Public pre-launch route | **Changed by owner** | Owner wants sign in -> home -> studio, with a Coming soon tag over the live camera (config.comingSoonTag). Upstream landing dialog (studioOpen) remains for direct studio links on the landing page |
| Camera-only start, mic on demand (§13-14) | **Not done** | recording pipeline untouched on purpose; needs real-device A/V sync tests |
| Saving / Saved / Save failed state machine (§15) | Not tested | not reviewed in this pass |
| Key Light (§11) | Partially verified | static radial, opacity only, outside canvas, off for reduced motion; red tally frame while recording. Not measured on Redmi 14C |
| Studio IA regroup (Scene/Looks/Show/Audio/More) | Not done | all panels and IDs preserved |
| 320/360/390 reflow, 24px targets | Verified | 7 pages, no horizontal overflow, no target < 24px |
| 200% text resize, keyboard order, screen reader | Not tested | |
| Core Web Vitals, live Studio perf on Android | Not tested | |
| Secrets scan of tracked files | Verified | only a fake `service_role` string in a test; history not scanned |
| Qualitative user round | Not tested | requires people |
