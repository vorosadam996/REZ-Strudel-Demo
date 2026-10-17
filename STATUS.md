# Status

Local demo complete. Independent web project; no native-app source or history copied.

Scope: 16-step bass sequencer, transport, tempo, volume, cutoff/resonance and reset.

- PASS: six automated test groups, production build, Chrome Web Audio signal and transport checks, step/note/parameter editing and reset, narrow-viewport layout.
- NOT VERIFIED: real-phone audio, human listening quality, long-run behavior and actual background-tab event handling.
- Public repository: https://github.com/vorosadam996/REZ-Strudel-Demo
- Live demo: https://vorosadam996.github.io/REZ-Strudel-Demo/
- PASS: GitHub API confirmed a public, separate repository and a successful Pages build from main/docs. The live HTTPS page loaded in Chrome, entered running audio state after Play, scheduled notes and produced measured nonzero signal.
- The separate native application's repository remained private, and its working tree/commit were unchanged during final separation checks.

See VALIDATION.md for evidence and limits. The source and distribution directories are separate from every native application project. The default audio level is deliberately conservative.
