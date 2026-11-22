# Prism Size — features (behaviour to keep)

## Scan
- Pick a drive, a quick folder (Desktop / Downloads / Documents) or any folder; Rust scanner `prism-scan.exe` (parallel, rayon) streams progress, falls back to the JS worker if the exe is missing.
- Results are saved (`<userData>\scans\*.json.gz`) and the last one is reopened on start — except scans > 400 000 files (too slow to parse; user is warned when opening one by hand).
- Cancel any time.

## Views (left bar)
| View | File | What it does |
|---|---|---|
| Space tree | `tree.js` | Force-directed glass orbs; drag an orb onto a folder = real move. "Projection" toggles show media thumbnails / file icons on orbs. |
| Treemap | `treemap.js` | Nested tiles, area = size; drag tile onto folder tile = move. |
| Sunburst | `sunburst.js` | Rings per folder level. |
| Dashboard | `dashboard.js` | Drives, file-type donut, age histogram, biggest files/folders. |
| Apps | `apps.js` | Installed programs with size/age; uninstall opens the program's own uninstaller / Windows Settings. |
| Cleaner | `cleaner.js` | Junk (temp, Windows temp, Chrome/Edge cache, crash dumps, shader cache, npm/pip cache), duplicates (hash), big-and-old files, empty folders. |
| Search | `search.js` | Live walk of the disk with size / type / age filters. |
| Shield | `shield.js` | On-demand Microsoft Defender scan of a folder (report only, links to Windows Security). |

## File actions
Move (drag), rename, new folder, delete → Recycle Bin, open, show in Explorer, open Recycle Bin. System and main user folders (incl. OneDrive root, Pictures/Music/Videos, other profiles, Prism own folder) are locked (`whyProtected`). If Windows would delete permanently (no bin on that drive / bin full-size / delete-immediately) the user must confirm a permanent delete first. A second launch focuses the existing window.

## Shell (shared with all Prism apps)
Frameless glass window, TH/EN switch, appearance menu on the moon/sun button (Light/Dark + Glass/Classic — Classic is flat and still: no moving background, refraction or decorative animation), ⓘ About with GitHub update check → download → restart, keyboard-friendly.
