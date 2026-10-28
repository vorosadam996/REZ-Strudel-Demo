# REZ / Little Acid

A small, open-source **acid-only 16-step sequencer** powered by Strudel. The initial **User Acid 168** bassline starts at **168 BPM** and **15% master level**. Playback starts only when you press Play.

**[Play the demo](https://vorosadam996.github.io/REZ-Strudel-Demo/)** · **[License](LICENSE)** · **[Validation](VALIDATION.md)** · **[Third-party notices](THIRD_PARTY_NOTICES.md)**

## Play

1. Start at a comfortable device volume, then press **Play**.
2. Toggle steps and select notes. Step 08 has two individually editable sub-notes.
3. Change **TEMPO** (70–180 BPM), **CUTOFF**, **RESONANCE** and **LEVEL** (0–70%). Edits apply during playback; LEVEL controls a real master gain.
4. **Stop** parks the master gain and hushes the scheduler. **Stop & reset to the acid line** restores the original notes, 168 BPM and 15% level.

The app stops on page hide. No microphone, MIDI permission, account, analytics or external fonts are used. The acid sound is synthesized locally and requires no sample CDN. The optional recorded-loop player downloads four local WAV loops (about 4 MB) only when you press **Play loop**. Browser audio, audible Stop/restart and physical-device behavior still need human verification.

## Recorded loops

Choose recording **A/B** and part **1/2**, then press **Play loop**. Each recording provides two four-bar loops at an estimated 88 BPM. Changes during playback take effect on the next bar; changes during initial loading select the loop that starts. The loop tempo is fixed and independent of the acid TEMPO control.

The loop FILTER moves from low-pass on the left to high-pass on the right, with an open centre. Loop resonance and level are separate from the acid controls. Starting either player stops the other. Reset stops both and restores their defaults. Original recordings are preserved locally; only the four extracted loops are included. Their publication was authorized by the owner on 2026-10-28.

Regenerate the loops with `node tools/make-loops.mjs <folder-containing-the-two-original-WAVs>`. The manifest records source hashes and sample positions; originals are not modified.

## Preserved original

`USER_ACID_CODE` in `src/state.js` preserves the original full Strudel stack, including drum calls, verbatim. Play uses `acidCode(state)` instead: the editable bassline alone, without drums. The complete original is reference source, not a promise that this release plays its drum bank.

The development workspace separately retains the three original packs, sample files, studio experiment and Hercules material. The publication branch intentionally contains only the standalone acid demo and its corresponding source, tests, build inputs and notices. Native macOS/iOS source and history are not included.

## Run locally

Requires Node.js 22.15+ (the tests use `node:module` registerHooks) and npm; checked here with Node 24.21.0.

```sh
npm ci --ignore-scripts
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

`docs/` is generated for GitHub Pages (main → /docs). Rebuild it with source changes. A development/release-branch push does not update the main-based public site. Review and merge are separate steps.

## Licensing and feedback

AGPL-3.0-or-later; see LICENSE and THIRD_PARTY_NOTICES.md. Strudel provides scheduling, synthesis and effects; dependencies are pinned by package-lock.json. Source and dependency notices are linked from the app. Report bugs with browser/OS and reproduction steps, without credentials or private files. Human listening, mobile audio and long-run behavior remain unverified; see VALIDATION.md.
