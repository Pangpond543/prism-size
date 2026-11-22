# Prism Size — code map

```
prism-size/
  package.json            dev workspace: scripts + electron-builder config (app dir = app/)
  app/
    main.js               Electron main: window, all ipcMain.handle channels, file actions + protection, junk defs, apps list, Defender
    preload.js            exposes the IPC api to the renderer (contextIsolation, sandbox)
    src/worker.js         worker_threads: JS scan fallback, duplicates, search, dir sizes, clean
    src/updater.js        GitHub release check / download / apply
    scanner/src/main.rs   prism-scan: parallel scanner, JSON lines on stdout (progress "p", result "r")
    renderer/
      index.html, css/style.css, css/fonts.css, fonts/ (IBM Plex Sans Thai, Prompt, Kanit)
      js/core.js          state, bus, api wrapper, formatting, tree mutations (bubble/detach/attach), modal/toast
      js/app.js           boot, views switch, saved scans, test hooks (env), theme, BIG_SCAN guard
      js/i18n.js + lang-en.js   T`` tag, Thai → English table
      js/bg.js            animated pastel gradient background
      js/<view>.js        one file per view (see features.md)
  build/icon.ico|png      app icon
  dist/win-unpacked/      ← what the user's shortcut runs
```

IPC channel names (`win:min`, `update:check`, `fs:move` …) are the template the other Prism apps copy.
Data: Electron `userData` (= `%APPDATA%\<app name>`) holds `scans\` and localStorage (theme, language, projection toggles).
