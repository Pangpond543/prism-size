# Prism Size — notes for Claude

Glass disk map for Windows: scan a drive/folder, see what takes space, move/delete real files by dragging.
Also: installed-apps sizes, safe cleaner, search, Defender virus scan. TH/EN, light/dark.
It is the **source of truth for the Prism suite shell** (title bar, About/updater, i18n, theme).

Read first: `../CLAUDE.md` (suite rules) and `../docs/LESSONS.md`.
More detail: `docs/features.md`, `docs/architecture.md`, `docs/pitfalls.md`, `docs/changelog.md`.

## What the user opens
Desktop `Prism Size.lnk` → `prism-size\dist\win-unpacked\Prism Size.exe`.
A change is NOT delivered until `npm run dist` has rebuilt that folder (close Prism Size first or it fails with EBUSY) and you have checked the exe timestamp there.

## Build / run (from `prism-size/`)
- `npm run build:scanner` — Rust scanner (`app/scanner`, GNU toolchain; cargo in `%USERPROFILE%\.cargo\bin`).
- `npm run dist` — scanner + electron-builder → `dist/win-unpacked`, `dist/Prism-Size-<ver>-Setup.exe` / `-Portable.exe`.
- Dev launch from Claude's shell: `env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe app`
  (the shell inherits `ELECTRON_RUN_AS_NODE`; without `-u` Electron silently runs as Node and no window appears).
- Use `--user-data-dir=C:\Users\pigvi\PrismSizeTest` for test runs, so test scans/theme don't land in (virtual) AppData.
- One instance at a time (parallel instances fight over the GPU cache → blank window).
- Release: bump `version` in `app/package.json`, push tag `vX.Y.Z` → GitHub Actions (`.github/workflows/release.yml`) builds and attaches Setup + Portable. Repo: `Pangpond543/prism-size` (`app/prism.config.json`). This is the only Prism app in git so far.

## Test hooks (env vars, read in `app/main.js` → `sys:info`)
`PRISM_SHOT=<png>` + `PRISM_SHOT_DELAY=<ms>` screenshot then quit · `PRISM_AUTOSCAN=<folder>` · `PRISM_VIEW=tree|treemap|sunburst|dashboard|apps|cleaner|search|shield` · `PRISM_LANG=th|en` · `PRISM_NOCACHE=1` (don't reopen saved scan) · `PRISM_DEBUG=1` (renderer console → stdout) · `PRISM_ACT=expand,deep,select,proj,dark,light,info`.
`dark` persists in localStorage → run once with `PRISM_ACT=light` afterwards.

## Rules specific to this app
- File actions go through `whyProtected()` in `app/main.js` — never weaken it; Windows/system folders and the user's main folders stay locked. Deletes go to the Recycle Bin (`fs:trash`), never permanent.
- Thai UI strings are wrapped in `` T`…` ``; English lives in `app/renderer/js/lang-en.js` keyed by the Thai string (`{}` = interpolation). Every new Thai string needs a line there.
- Boot must stay responsive: saved scans with more than `BIG_SCAN = 400000` files are not auto-reopened (`app/renderer/js/app.js`).
