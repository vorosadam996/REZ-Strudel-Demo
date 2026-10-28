# Third-party notices

## Strudel

This project uses `@strudel/web` **1.3.0**, licensed AGPL-3.0-or-later, and its bundled Strudel dependencies. Original authors include Felix Roos, Alex McLean and the Strudel contributors. Their notices remain in the upstream packages.

- Project and documentation: https://strudel.cc/
- Integration and licensing guidance: https://strudel.cc/technical-manual/project-start/
- Upstream source: https://codeberg.org/uzu/strudel
- Exact web package and included source: https://registry.npmjs.org/@strudel/web/-/web-1.3.0.tgz
- Exact transitive package versions, source tarballs and integrity hashes: `package-lock.json`.

The upstream packages are used without edits. The demo supplies a new interface and invokes public Strudel controls/scheduler/audio APIs. No external fonts are included. The local development workspace retains offline uzu/TR909 WAV samples, but they are excluded from the acid-only publication branch and build. The published runtime synthesizes its bassline and does not load those samples. No redistribution right is asserted for excluded assets. The complete AGPL license is in `LICENSE` and is also served by the site.

## Build tools and other dependencies

Vite and its build-time dependencies retain their own licenses; the root AGPL license does not replace their notices. `DEPENDENCIES.json` lists the installed package names, versions, declared licenses and source locations. Installation downloads exact package artifacts using the lockfile. License files in those artifacts must be preserved when redistributing them.

`@strudel/web` includes code from additional libraries in its prebuilt bundle. The site serves the upstream bundle's license comments together with a package notice inventory. No claim is made that REZ authored upstream library code.
