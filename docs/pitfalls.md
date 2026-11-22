# Prism Size — pitfalls (symptom → cause → do this)

- **No window, no error when launching from Claude's shell** → shell has `ELECTRON_RUN_AS_NODE` set → launch with `env -u ELECTRON_RUN_AS_NODE …/electron.exe app`.
- **`npm install electron` gave no binary** → postinstall didn't run → `node node_modules/electron/install.js` (~160 MB).
- **Blank window during tests** → two instances running → run one at a time.
- **App "freezes" at start (only the logo animates, buttons dead)** → it auto-reopened a huge saved scan (whole C:\, 1.56 M files, ~50 s parse on the renderer) → keep the `BIG_SCAN` guard; never auto-load huge scans on the UI thread.
- **`npm run dist` fails with EBUSY on dist\win-unpacked** → Prism Size is open → close it (`taskkill //F //IM "Prism Size.exe"`) and rebuild.
- **My test run doesn't reproduce the user's state** → Claude's shell sees a virtual AppData (different localStorage + scans) → for the user's real data use the schtasks trick in `../docs/LESSONS.md`; for clean tests use `--user-data-dir=C:\Users\pigvi\PrismSizeTest`.
- **Cleaner tested from my shell cleans the wrong place** → `%LOCALAPPDATA%`/temp paths resolve to the MSIX virtual store from my shell → never treat a cleaner test from my shell as proof of what the user's run does.
- **`dark` test hook leaves the user in dark mode** → localStorage persists → run `PRISM_ACT=light` once afterwards (in the test user-data dir).
- **Text stays Thai in EN mode** → missing entry in `lang-en.js`.

- **"Move to Recycle Bin" deleted for good** → Windows (shell.trashItem) deletes permanently on drives with no bin, with bin set to delete-immediately, or for items over the bin size → always go through `trashPath()` (asks first); never call `fs:trash` directly from new UI.
- **In-app update says network error** → GitHub release downloads redirect to `release-assets.githubusercontent.com`; keep it in `HOSTS` in `src/updater.js`.
- **Duplicate finder hangs / downloads OneDrive files** → online-only placeholders have size but `st.blocks===0`; skipped in worker.js.
- **Test files named .bin/.dat show no duplicates** → those extensions are on the protected list; use .mp4/.jpg in tests.
- **Test hook clicked `<html>` instead of the menu button** → `<html>` itself carries `data-look="glass"|"classic"`, so `querySelector('[data-look=glass]')` matches the root first → always scope menu selectors (`#theme-pop [data-look=…]`).
- **Classic look shows a white-on-white well / invisible hover** → old light styles use translucent white on glass; on a solid white panel give it `var(--c-fill)` / `var(--c-hover)` in the `html[data-look=classic]` block.
