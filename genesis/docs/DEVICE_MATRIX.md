# Device test matrix (brief A2). Fill one row per device from the Diagnostics "Copy report".
| Device | Browser | Engine | Cov % | Seg ms | fps (720p) | To camera ms | To cutout ms | Battery/30 min | Heat | Empty-mask bug? | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Redmi 14C | Chrome | | | | | | | | | | |
| Low-end Android 2-3 GB | Chrome | | | | | | | | | | |
| Flagship Android | Chrome | | | | | | | | | | |
| iPhone | Safari | | | | | | | | | | |
| Windows laptop (integrated GPU) | Chrome | | | | | | | | | | |
| MacBook | Safari/Chrome | | | | | | | | | | |
Targets (brief section 6): camera < 1 s warm, cutout < 1.5 s warm, >= 24 fps phone 720p, >= 30 fps laptop, battery < 15%/30 min.

## Execution evidence status — 26 November 2026

No physical Android, iOS, Windows or macOS device session was performed in this repository execution. The rows above are required targets, not measured results. Leave measurements blank until a real Diagnostics report is captured on that exact device/browser/engine combination. Do not copy FPS, latency, RAM, battery or thermal values from Chromium CI or another device.

| Target row | Current evidence status |
|---|---|
| Redmi 14C | BLOCKED — no live device session or Diagnostics report captured |
| Low-end Android 2–3 GB | BLOCKED — no identified test device/report |
| Flagship Android | BLOCKED — no live device session or Diagnostics report captured |
| iPhone Safari | BLOCKED — no physical iOS session or Safari report captured |
| Windows integrated GPU | BLOCKED — no physical device session or Diagnostics report captured |
| MacBook | BLOCKED — no physical device session or Diagnostics report captured |

The synthetic Chromium camera gate is integration/regression coverage only. It is not a substitute for physical-device camera lifecycle, sustained performance, battery, thermal or memory evidence.
