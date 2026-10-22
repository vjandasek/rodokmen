# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Radial descendant family tree ("Rodokmen") as a web app for relatives, many of them elderly and not technical: PCs, tablets and phones. The normal view must stay very simple. UI is Czech, output vector-only (SVG on screen, vector PDF poster). Vite + TypeScript, no framework. It replaces an earlier WPF desktop app (kept in a separate repo).

```bash
npm run dev        # http://localhost:5173/ (normal view), /?dev (developer mode: metrics, overlap outlines, "Parametry" panel)
npm test           # vitest
npm run typecheck
npm run build
```

- Node 24 (`.nvmrc`). `vite.config.ts` polls for file changes, because the project used to live on `/mnt/c` under WSL2.
- **Data:** `data/` (gitignored, **real personal data**; the only copy for now still lives in the old repo's working folder and has not been moved here yet, so tests that need it are skipped). `family.json` plus dated copies `family-YYYY-MM-DD_HHMM.json` saved by the developer-mode editor (`edit.ts`, `editor.ts`, `save.ts`); the dev server serves the newest (`/api/family-latest` in `vite.config.ts`). Format version 2: a flat list of people `{id, firstName, lastName, maidenName, sex, living, bloodRelated, parentBlood, parentNotBlood, partners:[{id, married, order}], title, bornDate, bornPlace, deathDate, deathPlace}` (dates stored strictly as `dd.mm.yyyy`; the editor also accepts `d.m.yyyy` and pads it) plus `rootId` and an optional `familyName` (the title: "Rodokmen – <familyName>" on screen, just the name on the PDF poster; edited by clicking the title in developer mode). Never overwrite or delete these files; back them up before experiments.
- **Pipeline** (`main.ts` `render`): `layoutTree` (`layout.ts`: concentric rings with fixed-point iteration and contour packing in angle space, then the spreading pass in `spread.ts`/`fan.ts`) → `resizeLayout` (`resize.ts`: enlarges boxes in place to the display scale) → `separateBoxes` (`separate.ts`: pushes boxes that are too close apart along their ring) → `clearLines` (`clear.ts`: turns a box aside when another family's line passes behind it) → `renderScene` (`render.ts`: SVG string). Partners hang off the blood member (`model.ts`) and are drawn inside its box.
- Pan/zoom changes the SVG `viewBox` (`panzoom.ts`), never a transform on the scene group, because Chrome rasterises transformed groups and the tree turns blurry.
- PDF (`pdf.ts`, `poster.ts`): `renderScene` SVG → svg2pdf.js → jsPDF, loaded by dynamic import on click, with Noto Sans TTF embedded from `src/fonts/`. svg2pdf ignores `hsl()` colours (write hex) and misplaces `dominant-baseline="central"` (use `centralBaseline`).
- Defaults for every layout and render option are in `defaultOptions` (`layout.ts`) and `panel.ts` (`DISPLAY_SCALE`, `DEFAULT_LOCKED`).
- **Publishing** (`npm run publish`, `scripts/publish.ts`; `-- --dry-run` builds into `dist-public/` without pushing, `-- --data <file>` picks the data file): the newest data file is stripped (`strip.ts`: living people keep only their names; a maiden name stays only as the surname when they have no other), encrypted with the shared family password (`vault.ts`: AES-GCM, PBKDF2-SHA256 600 000 iterations, password normalized to lower case and single spaces) and embedded in `index.html`; then `scripts/leaks.ts` refuses to publish if any name, place or date of the full data is readable in the built files, and the `gh-pages` branch is replaced by a single fresh commit (served by GitHub Pages). On the published page (`unlock.ts`) nothing is shown before the password, developer mode is off, and the key can be remembered on the device.
- **The repo is public (or will be):** never commit personal data. In code, comments, test titles and commit messages, refer to people by id, never by name, and use made-up example dates, never dates from the data. `HANDOFF.md` (local working notes) is gitignored.
