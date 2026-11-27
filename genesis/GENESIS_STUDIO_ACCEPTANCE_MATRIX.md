# Studio acceptance matrix (2026-11-27)

All browser rows: Chrome 153, software GL, Chrome's synthetic fake camera/mic. VERIFIED here means it passed in that environment only. No row is a phone result.

| Area | Evidence | Status |
|---|---|---|
| Control wiring | `tools/audit_controls.py`: 222 controls with an id, 0 without a JS reference | VERIFIED (wiring only, not behaviour) |
| J1 Guest: start camera, pick scene, record, stop, saved with real bytes | t61 | PASS |
| J2 Returning: reload keeps the recording once (no loss/duplicate) and restores the chosen scene | t61 | PASS (scene restore was a real bug, fixed) |
| J1 Projects page lists the saved recording | t61 | PASS |
| J3 Camera: start, stop releases tracks, restart, lost track leaves Start usable | t61 | PASS |
| J3 Camera permission denied: button usable, explanation shown, retry works, no page errors | t61 | PASS |
| J6 Go Live: RTMP URL rejected, Go Live disabled, 401 from server surfaces as a named error, never shows live, preview keeps running | t61 | PASS |
| Phone 390x844 / tablet 820x1180 / desktop 1440x900: camera starts, no horizontal overflow, no console errors, 0 unlabeled controls, 0 targets under 24 px (checkbox measured via its label) | t60, screenshots in `reports/screenshots/` | PASS |
| All 21 pages x 3 viewports render without page errors | t62 | PASS |
| Segmentation modes, MODNet/RVM/threads/UltraMatte/matte-edge/enhance gates | t40-t44, t49, t50 | PASS (synthetic) |
| J4 Long recording (audio/video sync over 30+ min, memory) | | NOT RUN (needs real time and a phone) |
| J5 Edit and export from the UI (trim, cancel, retry, large file) | export python suites only | NOT RUN end-to-end in the browser |
| J7 Keyboard-only traversal of every panel, screen reader, 200% zoom | first-focus check only | NOT RUN |
| Recording while engine switches, tab-hide during recording | engine switching is blocked by existing rule; tab-resume cache reset is unit-tested only | PARTIAL |
| Real devices (Redmi 14C class, iOS Safari, tablet) | `docs/DEVICE_MATRIX.md` blank on purpose | BLOCKED |
