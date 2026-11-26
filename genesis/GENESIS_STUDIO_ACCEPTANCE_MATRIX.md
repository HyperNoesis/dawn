# Studio acceptance matrix (2026-11-26)

Method so far: static inventory only (`tools/audit_controls.py` → `reports/studio_control_inventory.json`). 222 controls with an id in studio.html; **0** have no JS reference. That proves wiring exists, not that each control works.

| Area | Evidence | Status |
|---|---|---|
| Camera start / preview / not frozen (fake camera) | t40 gate | PASS (synthetic camera, software GL) |
| Segmentation modes, MODNet/RVM/threads | t41, t43, t44 | PASS (synthetic) |
| UltraMatte inference on bundled models | t50 | PASS (synthetic) |
| Matte edge / composite | t49 | PASS (synthetic) |
| Export model download/resume/cache | t42 + export python suites | PASS |
| Recording, audio, graphics, looks, prompter, go-live, projects, editor | existing unit_* suites only | NOT RUN end-to-end this session |
| User journeys 1–7 (guest, returning, camera failure, long recording, edit/export, WHIP, responsive) | | NOT RUN |
| Per-control event→state→result audit | | NOT RUN |
| Phone/tablet/desktop screenshots, keyboard-only, reduced motion | | NOT RUN |
