# Validation — 2026-10-17

## PASS: observed in this build

- Six Node test groups: safe 16-step patterns/all-rest handling; numeric limits/invalid input; independent reset state; cancellation of pending audio startup; duplicate Play/restart handling; recovery from failed audio unlock.
- Production build completed with the pinned lockfile. Dependency installation reported zero known vulnerabilities at installation time; this is not a comprehensive security audit.
- Chrome on macOS: the production bundle loaded and the real Web Audio context entered `running` after Play. Strudel scheduled notes and a real analyser measured nonzero signal (default patch peak approximately 0.042).
- Step enable and pitch selection, tempo edit to 144 BPM, filter/resonance edits, Stop, restart and Reset were exercised through the browser UI. The changed patch produced a measured peak of approximately 0.054 at the tested level.
- After Stop the scheduled-note count stayed fixed and the analyser returned to 0.0000. Reset restored the initial pattern and tempo and left playback stopped.
- No browser warning/error entries were observed during the production playback check. Approximately 90 notes were scheduled in one continuous production run; this is a short functional check, not a long-duration stability result.
- A 390 × 844 desktop viewport was visually inspected; the 16 steps and controls reflowed without document horizontal overflow. This is layout testing, not physical-phone testing.
- Source/license page and local license asset are included. UI and code are English; no native app files or history were copied into this project.

## NOT VERIFIED / limits

- Human listening quality, device speaker/headphone output, long-run timing and 15-minute playback.
- Real iPhone/Safari and Android behavior, incoming phone calls, screen locking and audio interruptions.
- Background-tab stopping is implemented via visibility/pagehide events but was not proven by the automated browser, which reported both test tabs visible.
- Screen-reader behavior and a full accessibility audit.
- No audio export, MIDI, drums, saved patterns, share-state links or parity with the native app is claimed.

## Publication checks

Public repository and Pages checks are recorded in STATUS.md after deployment. A successful build alone does not prove a live deployment.
