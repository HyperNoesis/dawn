# Atelier v2.1 · Pass 3b — microphone-on-demand: audit result (NOT implemented, by design)

Spec §13–14 asks for camera-only start and microphone only when Record is pressed. It also says: if the refactor cannot be proven,
keep the current safe behaviour. This audit found the refactor is not safe to ship without real-device testing.

## Consumers of the microphone track (snapshot 1aa3ee4)
- js/app.js ~1069/1081/1088: one getUserMedia({video, audio}) at camera start; fallback to video-only when constraints fail.
- js/app.js ~1121: `new AudioChain(stream)` is built at camera start from stream.getAudioTracks()[0].
- js/app.js ~1314: Mic pill reads the stream's audio track.
- js/app.js ~2650 outAudioTrack(): returns the processed track (AudioChain) or the raw track; used by recording (~2703) and Go Live (~3124, ~3148).
- js/audio-chain.js ~44/67: raw + processed tracks; Music ducking, mic test, captions and teleprompter voice-following read VS.audioChain.
- js/audio-studio.js ~351: builds a mixed stream from dest.stream audio tracks.
- js/call.js, js/cam.js, js/ppmatting-lab.js: separate getUserMedia calls (call.js needs audio; cam.js / lab are video-only already).

## Why it is not a drop-in change
1. AudioChain, captions, mic test and Go Live all assume an audio track exists from camera start; making it lazy changes each of them.
2. MediaRecorder must not gain/lose tracks after start() (InvalidModificationError), so the processed track has to exist BEFORE recorder creation.
3. AudioContext must be created/resumed inside the Record tap gesture.
4. No real-device (Redmi 14C / Android WebView) testing was possible in this pass.

## Safe plan for a later pass
1. Add `ensureMic()` (single guarded path, reuses saved device/noise/echo settings, dedupes concurrent calls).
2. Camera start: video only; keep the current combined request behind a flag until the new path passes the gate.
3. Record tap: `await ensureMic()` -> build AudioChain -> build the final MediaStream (camera track + one processed audio track) -> create MediaRecorder -> start.
4. Denied mic: "Microphone is blocked" + Try again; "Record without sound" only if explicitly chosen and tested.
5. Gate: camera-only; mic allowed; mic denied; mic unplugged; second take; camera switch; AudioContext resume; 5-minute A/V sync; real Android browser + WebView.
