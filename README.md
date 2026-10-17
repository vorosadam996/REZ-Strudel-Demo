# REZ / Little Acid

A small, open-source bass playground for the browser. Sixteen steps, a sawtooth synth and a resonant filter. Powered by Strudel.

**[Play the demo](https://vorosadam996.github.io/REZ-Strudel-Demo/)** · **[License](LICENSE)** · **[Validation](VALIDATION.md)**

## Play

1. Start at a comfortable device volume and press **Play**.
2. Tap a numbered step to switch its note on or off; choose a pitch underneath.
3. Change **tempo**, **cutoff**, **resonance** or **level**.
4. **Stop** silences playback. **Reset pattern & sound** stops and restores the initial settings.

Audio starts only after a click/tap. Leaving the tab stops playback. Changes are temporary; reloading resets the demo. No microphone, MIDI permissions, account, analytics, external fonts or sample downloads are needed. Hosting providers still receive normal web requests.

## Deliberately small

- One 16-step bass sequencer, four beats per loop, 70–180 BPM.
- Eight selectable pitches in C minor, per-step on/off.
- Low-pass filter with bounded resonance and conservative gain.
- Real signal display and audio-state diagnostics.
- Responsive layout, keyboard-accessible controls and reduced-motion support.

No drums, Orbit pad, piano, MIDI, cloud storage or native-app source is included. This is an **independent web project**, not a port or release of the separate native macOS app. It does not share that app's source, Git history, dependencies or build output. Sound equivalence is not claimed.

## Run locally

Requires Node.js 22.12+ (or 20.19+ on the Node 20 line) and npm. Development was checked with Node 24.

```sh
npm ci --ignore-scripts
npm run dev
```

For a production build:

```sh
npm test
npm run build
npm run preview
```

The generated `docs/` directory is the GitHub Pages site. Rebuild and commit it together with source changes. GitHub Pages serves `main` → `/docs`. Do not edit generated files by hand. Dependencies are pinned in `package-lock.json`.

## Source and licensing

This demo is licensed **AGPL-3.0-or-later**. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The site links back to this repository and its source archive. Preserve the license, attribution, and corresponding-source obligations when distributing or hosting modified versions.

Strudel provides the musical pattern scheduler, synthesizer and effects. The demo's interface and state/transport code are in `src/`; installation/build inputs are in `package.json` and `package-lock.json`. There is no dependency on a private repository. The npm packages include upstream source modules; see notices for source locations.

## Feedback

Use Issues for bugs or ideas. Include browser/OS, steps to reproduce, and what happened. Never include tokens, passwords or private project files. Small, focused pull requests are welcome; please run the tests and build.

## Testing limits

See [VALIDATION.md](VALIDATION.md) for observed checks. A narrow desktop viewport does not prove real-phone audio behavior. iPhone/Android audio, assistive technology and extended listening require separate human/device testing. This is an early demo, provided without warranty.
