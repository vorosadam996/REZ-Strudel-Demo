# Validation

## Current acid-only build — 2026-10-24

- PASS: **36/36** silent Node tests in tests/state.test.js, rerun for this update. They check the verbatim original stack, the editable bassline including step 08 subdivisions, actual Strudel event output for default/edited notes and tempo/filter/resonance, bounded numeric inputs, independent reset, serialized live updates, asynchronous Play/Stop races, rejected evaluations and fail-closed master gain behavior. No real audio output is started by these tests.
- PASS: the current browser UI loaded at 168 BPM and 15% level, with the 16-step editor and enabled controls. Play was not pressed. This proves page readiness, not sound quality or audible control behavior.
- Publication scope: no WAVs, development conversation exports or native app source. The original full drum-inclusive code remains in src/state.js as a reference. The actual runtime plays synthesized acid only and loads no sample manifest.
- PASS: isolated production build (Vite 8.3.4, 8 transformed modules) with no WAV/sample directories or private transcript exports. The 650 kB Strudel runtime triggers a bundle-size warning; this is not a build failure. Publication branch: release/little-acid-20261024; remote status is a separate check.
- NOT VERIFIED: audible playback, live audible edits, Stop/tails/restart, physical phones, screen-lock/background behavior, long-run timing and accessibility. No hearing PASS is inferred from unit tests or old build results.

## 2026-10-17 checks — historical record (previous editable 16-step synth build)

Everything in this section was observed against the earlier interactive build (editable 16-step sequencer with live tempo/cutoff/resonance). It does **not** validate the current acid-only User Acid 168 build and must not be cited as validation for it.

## PASS: observed in that build

- Six Node test groups: safe 16-step patterns/all-rest handling; numeric limits/invalid input; independent reset state; cancellation of pending audio startup; duplicate Play/restart handling; recovery from failed audio unlock.
- Production build completed with the pinned lockfile. Dependency installation reported zero known vulnerabilities at installation time; this is not a comprehensive security audit.
- Chrome on macOS: the production bundle loaded and the real Web Audio context entered `running` after Play. Strudel scheduled notes and a real analyser measured nonzero signal (default patch peak approximately 0.042).
- Step enable and pitch selection, tempo edit to 144 BPM, filter/resonance edits, Stop, restart and Reset were exercised through the browser UI. The changed patch produced a measured peak of approximately 0.054 at the tested level.
- After Stop the scheduled-note count stayed fixed and the analyser returned to 0.0000. Reset restored the initial pattern and tempo and left playback stopped.
- No browser warning/error entries were observed during the production playback check. Approximately 90 notes were scheduled in one continuous production run; this is a short functional check, not a long-duration stability result.
- A 390 × 844 desktop viewport was visually inspected; the 16 steps and controls reflowed without document horizontal overflow. This is layout testing, not physical-phone testing.
- Source/license page and local license asset are included. UI and code are English; no native app files or history were copied into this project.

## NOT VERIFIED / limits (that build)

- Human listening quality, device speaker/headphone output, long-run timing and 15-minute playback.
- Real iPhone/Safari and Android behavior, incoming phone calls, screen locking and audio interruptions.
- Background-tab stopping is implemented via visibility/pagehide events but was not proven by the automated browser, which reported both test tabs visible.
- Screen-reader behavior and a full accessibility audit.
- No audio export, MIDI, saved patterns, share-state links or parity with the native app is claimed.

## Publication checks (that build — historical)

GitHub API confirmed that the separate demo repository is public and its Pages build succeeded. The public HTTPS page was then opened in Chrome: the ready UI loaded, Play started the audio context, notes were scheduled, and the signal analyser measured nonzero output (peak approximately 0.0404 at the beginning of the public-site check). Source/license links are served alongside the app. The native application's repository remained private. See STATUS.md for URLs. These checks do not replace the human/device checks listed above — and all relate to the previous build.
