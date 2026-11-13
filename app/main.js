// Prism — Electron main process
const { app, BrowserWindow, ipcMain, shell, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { Worker } = require('worker_threads');
const { spawn, execFile } = require('child_process');

let win = null;
const tasks = new Map(); // kind -> Worker | ChildProcess
const send = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };

/* ---------------------------------------------------------------- window */
function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1040, minHeight: 680,
    frame: false, show: false, backgroundColor: '#e9eefc',
    title: 'Prism Size',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), process.env.PRISM_LANG ? { query: { lang: process.env.PRISM_LANG } } : undefined);
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => send('win:state', true));
  win.on('unmaximize', () => send('win:state', false));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  if (process.env.PRISM_DEBUG) {
    win.webContents.on('console-message', (_e, level, message, line, source) => {
      console.log(`[renderer:${level}] ${message} (${path.basename(String(source))}:${line})`);
    });
  }
  if (process.env.PRISM_SHOT) {
    const delay = Number(process.env.PRISM_SHOT_DELAY || 6000);
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.PRISM_SHOT, img.toPNG());
      } catch (err) { console.error('shot failed', err); }
      app.quit();
    }, delay));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { killAll(); app.quit(); });

function killAll() {
  for (const t of tasks.values()) { try { t.terminate ? t.terminate() : t.kill(); } catch { /* gone */ } }
  tasks.clear();
}

/* ----------------------------------------------------------------- tasks */
function runTask(kind, data, onMsg) {
  cancelTask(kind);
  return new Promise((resolve) => {
    const w = new Worker(path.join(__dirname, 'src', 'worker.js'), { workerData: { kind: kind.split(':')[0], data } });
    tasks.set(kind, w);
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    w.on('message', (m) => {
      if (m.t === 'done') { finish(m.v); w.terminate(); }
      else if (onMsg) onMsg(m);
    });
    w.on('error', (err) => { console.error(kind, err); finish(null); });
    w.on('exit', () => { if (tasks.get(kind) === w) tasks.delete(kind); finish(null); });
  });
}
function cancelTask(kind) {
  const t = tasks.get(kind);
  if (!t) return false;
  tasks.delete(kind);
  try { t.terminate ? t.terminate() : t.kill(); } catch { /* gone */ }
  return true;
}

/* ------------------------------------------------------------------ scan */
function rustExe() {
  const candidates = [
    // packaged build: electron-builder copies the compiled scanner next to the asar (it cannot run from inside it)
    ...(process.resourcesPath ? [path.join(process.resourcesPath, 'bin', 'prism-scan.exe')] : []),
    path.join(__dirname, 'scanner', 'target', 'release', 'prism-scan.exe'),
    path.join(__dirname, 'bin', 'prism-scan.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function rustScan(exe, root, onProgress) {
  return new Promise((resolve) => {
    const p = spawn(exe, [root, '24'], { windowsHide: true });
    tasks.set('scan', p);
    let parts = [];
    let result = null;
    const handle = (line) => {
      if (!line) return;
      try {
        const m = JSON.parse(line);
        if (m.t === 'p') onProgress(m); else if (m.t === 'r') result = m;
      } catch (err) { console.error('scan parse', err.message); }
    };
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (chunk) => {
      let start = 0, idx;
      while ((idx = chunk.indexOf('\n', start)) >= 0) {
        parts.push(chunk.slice(start, idx));
        handle(parts.join('')); parts = [];
        start = idx + 1;
      }
      if (start < chunk.length) parts.push(chunk.slice(start));
    });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      if (parts.length) handle(parts.join(''));
      if (tasks.get('scan') === p) tasks.delete('scan');
      resolve(result);
    });
  });
}

ipcMain.handle('scan:start', async (_e, root) => {
  root = normRoot(root);
  if (!root || !fs.existsSync(root)) return { error: 'ไม่พบโฟลเดอร์นี้' };
  cancelTask('scan');
  const onP = (m) => send('scan:progress', m);
  const exe = rustExe();
  send('scan:engine', exe ? 'rust' : 'node');
  let res = exe ? await rustScan(exe, root, onP) : null;
  if (!res && !exe) res = await runTask('scan', { root, keep: 24 }, onP);
  if (!res) return { cancelled: true };
  res.savedAt = Date.now();
  saveScan(res).catch((err) => console.error('cache save', err.message));
  return res;
});

/* ----------------------------------------------------------- saved scans */
// Every finished scan is kept (gzipped) so the app reopens instantly on the last result.
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
const scanDir = () => path.join(app.getPath('userData'), 'scans');
const scanFile = (root) => crypto.createHash('sha1').update(String(root).toLowerCase()).digest('hex').slice(0, 16) + '.json.gz';
async function readIndex() {
  try { const a = JSON.parse(await fsp.readFile(path.join(scanDir(), 'index.json'), 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; }
}
let saveChain = Promise.resolve();
function saveScan(res) {
  saveChain = saveChain.catch(() => {}).then(async () => {
    const root = res.root && res.root.n;
    if (!root) return;
    await fsp.mkdir(scanDir(), { recursive: true });
    const file = scanFile(root);
    const buf = await gzip(Buffer.from(JSON.stringify(res)), { level: 4 });
    await fsp.writeFile(path.join(scanDir(), file + '.tmp'), buf);
    await fsp.rename(path.join(scanDir(), file + '.tmp'), path.join(scanDir(), file));
    const idx = (await readIndex()).filter((e) => e.file !== file);
    idx.unshift({ root, file, at: res.savedAt || Date.now(), bytes: res.root.s || 0, files: res.root.c || 0, engine: res.engine || '', size: buf.length });
    await fsp.writeFile(path.join(scanDir(), 'index.json'), JSON.stringify(idx.slice(0, 24)));
  });
  return saveChain;
}
ipcMain.handle('cache:list', async () => {
  const idx = await readIndex();
  return idx.filter((e) => fs.existsSync(path.join(scanDir(), e.file))).sort((a, b) => b.at - a.at);
});
ipcMain.handle('cache:load', async (_e, root) => {
  try {
    await saveChain.catch(() => {});
    const buf = await gunzip(await fsp.readFile(path.join(scanDir(), scanFile(root))));
    return JSON.parse(buf.toString('utf8'));
  } catch { return null; }
});
ipcMain.handle('cache:save', async (_e, res) => { try { await saveScan(res); return true; } catch { return false; } });
ipcMain.handle('cache:delete', async (_e, root) => {
  const file = scanFile(root);
  await fsp.rm(path.join(scanDir(), file), { force: true }).catch(() => {});
  const idx = (await readIndex()).filter((e) => e.file !== file);
  await fsp.writeFile(path.join(scanDir(), 'index.json'), JSON.stringify(idx)).catch(() => {});
  return true;
});

/* ------------------------------------------------- thumbnails (projection) */
// Windows shell thumbnails: real pictures for images, the cover frame for videos.
ipcMain.handle('thumb:get', async (_e, p, size) => {
  try {
    const s = Math.max(48, Math.min(512, Number(size) || 160));
    const img = await nativeImage.createThumbnailFromPath(p, { width: s, height: s });
    return img.isEmpty() ? null : img.toDataURL();
  } catch { return null; }
});

/* ------------------------------------------------------------ about/update */
const updater = require('./src/updater');
const pkg = require('./package.json');
function repoName() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'prism.config.json'), 'utf8'));
    const r = String(c.repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    return updater.validRepo(r) ? r : '';
  } catch { return ''; }
}
ipcMain.handle('about:info', () => ({ version: app.getVersion(), repo: repoName(), electron: process.versions.electron, rust: !!rustExe() }));
ipcMain.handle('about:openRepo', () => { const r = repoName(); if (r) shell.openExternal(`https://github.com/${r}`); return !!r; });
ipcMain.handle('update:check', () => updater.check(repoName(), app.getVersion()));
ipcMain.handle('update:apply', async () => {
  const repo = repoName();
  const info = await updater.check(repo, app.getVersion());
  if (!info.ok) return info;
  if (!info.hasUpdate) return { ok: false, reason: 'uptodate' };
  if (app.isPackaged) {
    // installed / portable build: fetch the matching .exe from the GitHub release; it is launched on "restart"
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    const isPortable = !!(process.env.PORTABLE_EXECUTABLE_FILE && portableDir);
    const asset = (info.assets || []).find((a) => (isPortable ? /portable.*\.exe$/i : /setup.*\.exe$/i).test(a.name));
    if (!asset) return { ok: false, reason: 'noasset' };
    const dir = isPortable ? portableDir : path.join(os.tmpdir(), 'prism-update');
    try {
      await fsp.mkdir(dir, { recursive: true });
      const dest = path.join(dir, asset.name);
      send('update:step', { step: 'download', f: 0 });
      await updater.download(asset.url, dest, (g, t) => send('update:step', { step: 'download', f: t ? g / t : 0 }));
      pendingInstaller = dest;
      return { ok: true, version: info.latest };
    } catch (err) {
      return { ok: false, reason: 'network', detail: String(err.message || err) };
    }
  }
  const rs =path.join(__dirname, 'scanner', 'src', 'main.rs');
  const before = fs.existsSync(rs) ? fs.readFileSync(rs, 'utf8') : '';
  const r = await updater.apply(info.zip, __dirname, { expectName: pkg.name, onStep: (step, f) => send('update:step', { step, f }) });
  if (!r.ok) return r;
  // the Rust scanner is compiled locally — rebuild it when its source changed and cargo is around
  const after = fs.existsSync(rs) ? fs.readFileSync(rs, 'utf8') : '';
  if (after !== before) {
    send('update:step', { step: 'build', f: 0 });
    const cargo = path.join(os.homedir(), '.cargo', 'bin', 'cargo.exe');
    if (fs.existsSync(cargo)) r.built = (await updater.run(cargo, ['build', '--release', '--manifest-path', path.join(__dirname, 'scanner', 'Cargo.toml')], { timeout: 600000 })).ok;
  }
  return r;
});
let pendingInstaller = '';
ipcMain.handle('app:relaunch', () => {
  killAll();
  if (pendingInstaller && fs.existsSync(pendingInstaller)) {
    // hand over to the downloaded installer / new portable exe, then leave
    spawn(pendingInstaller, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    return app.exit(0);
  }
  app.relaunch(); app.exit(0);
});
ipcMain.handle('scan:cancel', () => cancelTask('scan'));

function normRoot(p) {
  if (!p) return '';
  p = String(p);
  if (/^[a-zA-Z]:$/.test(p)) p += '\\';
  p = path.resolve(p);
  return p;
}

/* -------------------------------------------------------------- system */
ipcMain.handle('sys:info', () => ({
  home: os.homedir(),
  quick: [
    { label: 'โฟลเดอร์ผู้ใช้', path: os.homedir(), icon: 'home' },
    { label: 'เดสก์ท็อป', path: app.getPath('desktop'), icon: 'desktop' },
    { label: 'ดาวน์โหลด', path: app.getPath('downloads'), icon: 'download' },
    { label: 'เอกสาร', path: app.getPath('documents'), icon: 'doc' },
    { label: 'Program Files', path: process.env.ProgramFiles || 'C:\\Program Files', icon: 'apps' },
  ].filter((q) => fs.existsSync(q.path)),
  rust: !!rustExe(),
  host: os.hostname(),
  version: app.getVersion(),
  env: { autoscan: process.env.PRISM_AUTOSCAN || '', view: process.env.PRISM_VIEW || '', act: process.env.PRISM_ACT || '', nocache: !!process.env.PRISM_NOCACHE },
}));

ipcMain.handle('drives:list', async () => {
  const out = [];
  for (let c = 67; c <= 90; c++) { // C..Z
    const root = String.fromCharCode(c) + ':\\';
    try {
      if (!fs.existsSync(root)) continue;
      const s = await fsp.statfs(root);
      const total = s.blocks * s.bsize, free = s.bfree * s.bsize;
      if (total > 0) out.push({ root, total, free, used: total - free });
    } catch { /* not ready */ }
  }
  return out;
});

ipcMain.handle('dialog:pickFolder', async (_e, title) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: String(title || 'เลือกโฟลเดอร์') });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('win:min', () => win.minimize());
ipcMain.handle('win:max', () => { win.isMaximized() ? win.unmaximize() : win.maximize(); return win.isMaximized(); });
ipcMain.handle('win:close', () => win.close());
ipcMain.handle('win:reload', () => win.webContents.reload());

/* ---------------------------------------------------------- file actions */
const low = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
function protectedRoots() {
  const e = process.env;
  const sysDrive = (e.SystemDrive || 'C:');
  return [
    e.SystemRoot || 'C:\\Windows', e.ProgramFiles, e['ProgramFiles(x86)'], e.ProgramData,
    sysDrive + '\\$Recycle.Bin', sysDrive + '\\System Volume Information', sysDrive + '\\Recovery', sysDrive + '\\Boot',
  ].filter(Boolean).map(low);
}
function exactProtected() {
  const home = os.homedir();
  return [home, path.dirname(home), path.join(home, 'AppData'), path.join(home, 'AppData', 'Local'),
    path.join(home, 'AppData', 'Roaming'), path.join(home, 'AppData', 'LocalLow'),
    app.getPath('desktop'), app.getPath('documents'), app.getPath('downloads'), __dirname].map(low);
}
const inside = (p, root) => p === root || p.startsWith(root + '\\');
function whyProtected(p) {
  const n = low(p);
  if (/^[a-z]:$/.test(n)) return 'ไม่สามารถย้ายหรือลบไดรฟ์ทั้งลูกได้';
  if (protectedRoots().some((r) => inside(n, r))) return 'เป็นโฟลเดอร์ระบบของ Windows — ล็อกไว้เพื่อความปลอดภัย';
  if (exactProtected().includes(n)) return 'เป็นโฟลเดอร์หลักของผู้ใช้ — ล็อกไว้เพื่อความปลอดภัย';
  return null;
}

async function exists(p) { try { await fsp.lstat(p); return true; } catch { return false; } }
async function uniqueTarget(destDir, name) {
  let target = path.join(destDir, name);
  if (!(await exists(target))) return target;
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  for (let i = 2; i < 1000; i++) {
    target = path.join(destDir, `${base} (${i})${ext}`);
    if (!(await exists(target))) return target;
  }
  throw new Error('มีไฟล์ชื่อซ้ำมากเกินไป');
}

ipcMain.handle('fs:move', async (_e, { src, destDir, name }) => {
  try {
    const why = whyProtected(src);
    if (why) return { ok: false, error: why };
    const d = low(destDir), s = low(src);
    if (protectedRoots().some((r) => inside(d, r))) return { ok: false, error: 'ปลายทางเป็นโฟลเดอร์ระบบ — ล็อกไว้เพื่อความปลอดภัย' };
    if (inside(d, s)) return { ok: false, error: 'ย้ายโฟลเดอร์เข้าไปในตัวเองไม่ได้' };
    if (low(path.dirname(src)) === d && !name) return { ok: false, error: 'อยู่ในโฟลเดอร์นี้อยู่แล้ว' };
    const st = await fsp.stat(destDir);
    if (!st.isDirectory()) return { ok: false, error: 'ปลายทางไม่ใช่โฟลเดอร์' };
    const target = await uniqueTarget(destDir, name || path.basename(src));
    try { await fsp.rename(src, target); }
    catch (err) {
      if (err.code !== 'EXDEV') throw err;
      await fsp.cp(src, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
      await fsp.rm(src, { recursive: true, force: true });
    }
    return { ok: true, path: target, name: path.basename(target) };
  } catch (err) { return { ok: false, error: friendly(err) }; }
});

ipcMain.handle('fs:trash', async (_e, p) => {
  try {
    const why = whyProtected(p);
    if (why) return { ok: false, error: why };
    await shell.trashItem(p);
    return { ok: true };
  } catch (err) { return { ok: false, error: friendly(err) }; }
});

ipcMain.handle('fs:rename', async (_e, { src, name }) => {
  try {
    const why = whyProtected(src);
    if (why) return { ok: false, error: why };
    if (!name || /[\\/:*?"<>|]/.test(name)) return { ok: false, error: 'ชื่อมีอักขระที่ใช้ไม่ได้ ( \\ / : * ? " < > | )' };
    const target = path.join(path.dirname(src), name);
    if (low(target) !== low(src) && await exists(target)) return { ok: false, error: 'มีชื่อนี้อยู่แล้ว' };
    await fsp.rename(src, target);
    return { ok: true, name };
  } catch (err) { return { ok: false, error: friendly(err) }; }
});

ipcMain.handle('fs:mkdir', async (_e, { dir, name }) => {
  try {
    if (!name || /[\\/:*?"<>|]/.test(name)) return { ok: false, error: 'ชื่อโฟลเดอร์ไม่ถูกต้อง' };
    if (protectedRoots().some((r) => inside(low(dir), r))) return { ok: false, error: 'โฟลเดอร์ระบบ — ล็อกไว้' };
    const target = path.join(dir, name);
    if (await exists(target)) return { ok: false, error: 'มีชื่อนี้อยู่แล้ว' };
    await fsp.mkdir(target);
    return { ok: true, name };
  } catch (err) { return { ok: false, error: friendly(err) }; }
});

ipcMain.handle('fs:open', async (_e, p) => { const r = await shell.openPath(p); return { ok: !r, error: r }; });
ipcMain.handle('fs:reveal', (_e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle('fs:recycleBin', () => { spawn('explorer.exe', ['shell:RecycleBinFolder'], { detached: true, stdio: 'ignore' }).unref(); return true; });

ipcMain.handle('fs:list', async (_e, dir) => {
  const out = [];
  try {
    const ents = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of ents) {
      if (e.isSymbolicLink() || !e.isFile()) continue;
      try { const st = await fsp.stat(path.join(dir, e.name)); out.push([e.name, st.size, Math.floor(st.mtimeMs / 1000)]); } catch { /* skip */ }
    }
  } catch { /* unreadable */ }
  out.sort((a, b) => b[1] - a[1]);
  return out;
});

ipcMain.handle('fs:readText', async (_e, p) => {
  try {
    const fh = await fsp.open(p, 'r');
    try {
      const buf = Buffer.alloc(24 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const slice = buf.subarray(0, bytesRead);
      if (slice.includes(0)) return { binary: true };
      return { text: slice.toString('utf8') };
    } finally { await fh.close(); }
  } catch (err) { return { error: friendly(err) }; }
});

ipcMain.handle('fs:stat', async (_e, p) => {
  try {
    const st = await fsp.stat(p);
    return { size: st.size, m: Math.floor(st.mtimeMs / 1000), b: Math.floor(st.birthtimeMs / 1000), a: Math.floor(st.atimeMs / 1000), dir: st.isDirectory() };
  } catch { return null; }
});

function friendly(err) {
  const c = err && err.code;
  if (c === 'EPERM' || c === 'EACCES') return 'ไม่มีสิทธิ์เข้าถึง (อาจต้องเปิดโปรแกรมแบบผู้ดูแลระบบ)';
  if (c === 'EBUSY') return 'ไฟล์กำลังถูกใช้งานโดยโปรแกรมอื่น';
  if (c === 'ENOENT') return 'ไม่พบไฟล์นี้แล้ว (อาจถูกย้ายหรือลบไปก่อน)';
  if (c === 'ENOTEMPTY' || c === 'EEXIST') return 'มีไฟล์ชื่อซ้ำที่ปลายทาง';
  return String((err && err.message) || err);
}

/* --------------------------------------------------- duplicates / search */
ipcMain.handle('dupes:start', (_e, opts) => runTask('dupes', opts, (m) => send('dupes:progress', m)));
ipcMain.handle('dupes:cancel', () => cancelTask('dupes'));
ipcMain.handle('search:start', (_e, opts) => runTask('search', opts, (m) => send('search:msg', m)));
ipcMain.handle('search:cancel', () => cancelTask('search'));

/* ------------------------------------------------------------------ junk */
function junkDefs() {
  const e = process.env;
  const L = e.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const defs = [
    { id: 'temp', label: 'ไฟล์ชั่วคราวของผู้ใช้', hint: 'ไฟล์ที่โปรแกรมต่าง ๆ สร้างทิ้งไว้ระหว่างทำงาน', paths: [os.tmpdir()] },
    { id: 'wintemp', label: 'ไฟล์ชั่วคราวของ Windows', hint: 'อาจต้องใช้สิทธิ์ผู้ดูแลระบบ', paths: [path.join(e.SystemRoot || 'C:\\Windows', 'Temp')] },
    { id: 'chrome', label: 'แคช Google Chrome', hint: 'รูปและไฟล์เว็บที่เก็บไว้ให้โหลดเร็วขึ้น', paths: ['Cache', 'Code Cache', 'GPUCache'].map((x) => path.join(L, 'Google', 'Chrome', 'User Data', 'Default', x)) },
    { id: 'edge', label: 'แคช Microsoft Edge', hint: 'รูปและไฟล์เว็บที่เก็บไว้ให้โหลดเร็วขึ้น', paths: ['Cache', 'Code Cache', 'GPUCache'].map((x) => path.join(L, 'Microsoft', 'Edge', 'User Data', 'Default', x)) },
    { id: 'crash', label: 'ไฟล์รายงานข้อผิดพลาด', hint: 'Crash dump และ Windows Error Reporting', paths: [path.join(L, 'CrashDumps'), path.join(L, 'Microsoft', 'Windows', 'WER')] },
    { id: 'shader', label: 'แคช Shader กราฟิก', hint: 'สร้างใหม่เองอัตโนมัติเมื่อเปิดเกม/โปรแกรม', paths: [path.join(L, 'D3DSCache'), path.join(L, 'NVIDIA', 'DXCache'), path.join(L, 'NVIDIA', 'GLCache')] },
    { id: 'npm', label: 'แคช npm', hint: 'แพ็กเกจที่ดาวน์โหลดเก็บไว้ ดาวน์โหลดใหม่ได้', paths: [path.join(L, 'npm-cache', '_cacache')] },
    { id: 'pip', label: 'แคช pip (Python)', hint: 'แพ็กเกจที่ดาวน์โหลดเก็บไว้ ดาวน์โหลดใหม่ได้', paths: [path.join(L, 'pip', 'Cache')] },
  ];
  for (const d of defs) d.paths = d.paths.filter((p) => fs.existsSync(p));
  return defs.filter((d) => d.paths.length);
}

ipcMain.handle('junk:scan', async () => {
  const defs = junkDefs();
  const flat = [];
  defs.forEach((d, di) => d.paths.forEach((p) => flat.push({ di, p })));
  const sizes = await runTask('dirsize:junk', { paths: flat.map((f) => f.p) }, null) || [];
  defs.forEach((d) => { d.size = 0; d.n = 0; });
  flat.forEach((f, i) => { const r = sizes[i] || { size: 0, n: 0 }; defs[f.di].size += r.size; defs[f.di].n += r.n; });
  return defs;
});

ipcMain.handle('junk:clean', async (_e, ids) => {
  const defs = junkDefs().filter((d) => ids.includes(d.id));
  const paths = defs.flatMap((d) => d.paths);
  if (!paths.length) return { freed: 0, removed: 0, failed: 0 };
  return await runTask('clean', { paths }, (m) => send('junk:progress', m)) || { freed: 0, removed: 0, failed: 0 };
});

/* ------------------------------------------------------- installed apps */
let appCache = [];
function ps(script) {
  return new Promise((resolve) => {
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => resolve(err ? '' : stdout));
  });
}

ipcMain.handle('apps:list', async () => {
  const script = `
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$keys='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
Get-ItemProperty $keys | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName } |
 Select-Object DisplayName,DisplayVersion,Publisher,EstimatedSize,InstallDate,InstallLocation,UninstallString,DisplayIcon | ConvertTo-Json -Compress`;
  const out = await ps(script);
  let arr = [];
  try { arr = JSON.parse(out.trim() || '[]'); if (!Array.isArray(arr)) arr = [arr]; } catch { arr = []; }
  const seen = new Set();
  appCache = [];
  for (const a of arr) {
    const key = `${a.DisplayName}|${a.DisplayVersion || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let loc = String(a.InstallLocation || '').replace(/^"|"$/g, '').trim();
    if (loc && !fs.existsSync(loc)) loc = '';
    let icon = String(a.DisplayIcon || '').replace(/,-?\d+$/, '').replace(/^"|"$/g, '').trim();
    if (icon && !fs.existsSync(icon)) icon = '';
    let date = 0;
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(a.InstallDate || ''));
    if (m) date = Math.floor(new Date(+m[1], +m[2] - 1, +m[3]).getTime() / 1000);
    appCache.push({
      id: appCache.length, name: String(a.DisplayName), version: a.DisplayVersion ? String(a.DisplayVersion) : '',
      publisher: a.Publisher ? String(a.Publisher) : '', size: a.EstimatedSize ? Number(a.EstimatedSize) * 1024 : 0,
      date, location: loc, icon, canUninstall: !!a.UninstallString, _un: a.UninstallString ? String(a.UninstallString) : '',
    });
  }
  return appCache.map(({ _un, ...rest }) => rest);
});

ipcMain.handle('apps:sizes', (_e, ids) => {
  const paths = ids.map((id) => (appCache[id] && appCache[id].location) || '');
  return runTask('dirsize:apps', { paths }, (m) => { if (m.t === 'size') send('apps:size', { id: ids[m.i], size: m.size }); });
});

ipcMain.handle('apps:uninstall', (_e, id) => {
  const a = appCache[id];
  if (!a || !a._un) return { ok: false, error: 'โปรแกรมนี้ไม่มีตัวถอนการติดตั้ง' };
  try {
    spawn('cmd.exe', ['/d', '/s', '/c', `"${a._un}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  } catch (err) { return { ok: false, error: friendly(err) }; }
});
ipcMain.handle('apps:settings', () => shell.openExternal('ms-settings:appsfeatures'));

ipcMain.handle('app:icon', async (_e, p) => {
  try {
    if (!p) return null;
    if (/\.ico$/i.test(p)) { const img = nativeImage.createFromPath(p); if (!img.isEmpty()) return img.resize({ width: 48 }).toDataURL(); }
    const img = await app.getFileIcon(p, { size: 'large' });
    return img.isEmpty() ? null : img.toDataURL();
  } catch { return null; }
});

/* ------------------------------------------------------------ antivirus */
function defenderExe() {
  const base = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows Defender', 'Platform');
  try {
    const vers = fs.readdirSync(base).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of vers) { const p = path.join(base, v, 'MpCmdRun.exe'); if (fs.existsSync(p)) return p; }
  } catch { /* fall through */ }
  const p = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe');
  return fs.existsSync(p) ? p : null;
}

ipcMain.handle('av:available', () => !!defenderExe());
ipcMain.handle('av:scan', (_e, target) => new Promise((resolve) => {
  const exe = defenderExe();
  if (!exe) return resolve({ ok: false, error: 'ไม่พบ Windows Defender ในเครื่องนี้' });
  if (!fs.existsSync(target)) return resolve({ ok: false, error: 'ไม่พบโฟลเดอร์เป้าหมาย' });
  cancelTask('av');
  const started = Date.now();
  // -DisableRemediation: report only — nothing is deleted or quarantined by this scan.
  const p = spawn(exe, ['-Scan', '-ScanType', '3', '-File', target, '-DisableRemediation'], { windowsHide: true });
  tasks.set('av', p);
  let out = '';
  const onData = (d) => { const s = d.toString('utf8'); out += s; send('av:log', s); };
  p.stdout.on('data', onData); p.stderr.on('data', onData);
  p.on('error', (err) => resolve({ ok: false, error: friendly(err) }));
  p.on('close', (code) => {
    const cancelled = tasks.get('av') !== p;
    if (!cancelled) tasks.delete('av');
    const threats = [];
    const re = /Threat\s*:\s*(.+)/g; let m;
    while ((m = re.exec(out))) threats.push({ name: m[1].trim(), files: [] });
    const fre = /^\s*file\s*:\s*(.+)$/gim; const files = [];
    while ((m = fre.exec(out))) files.push(m[1].trim());
    if (threats.length) threats[threats.length - 1].files = files; // best effort attribution
    resolve({ ok: true, cancelled, code, clean: code === 0 && !threats.length, threats, files, ms: Date.now() - started });
  });
}));
ipcMain.handle('av:cancel', () => cancelTask('av'));
ipcMain.handle('av:openSecurity', () => shell.openExternal('windowsdefender://threat'));
