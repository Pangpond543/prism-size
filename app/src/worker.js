// Background worker: scan / duplicates / search / dirsize / clean.
// Runs off the main thread so the UI never blocks.
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const post = (m) => parentPort.postMessage(m);
const done = (v) => post({ t: 'done', v });
const join = (d, n) => (d.endsWith('\\') || d.endsWith('/') ? d + n : d + path.sep + n);
const DAY = 86400;

function extOf(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1 || name.length - i - 1 > 10) return '';
  return name.slice(i + 1).toLowerCase();
}

/* ------------------------------------------------------------------ scan */
function scan({ root, keep = 24 }) {
  const started = Date.now();
  const now = Math.floor(started / 1000);
  let files = 0, dirs = 0, bytes = 0, errors = 0, lastPost = 0, tick = 0;
  const ext = new Map();
  const age = [0, 0, 0, 0, 0, 0], agen = [0, 0, 0, 0, 0, 0];
  let top = [], topMin = 0;
  const TOP = 300;

  const bucket = (m) => {
    const a = (now - m) / DAY;
    return a < 30 ? 0 : a < 180 ? 1 : a < 365 ? 2 : a < 730 ? 3 : a < 1825 ? 4 : 5;
  };

  function walk(dir, name) {
    const node = { n: name, s: 0, c: 0, m: 0, rc: 0, rs: 0, d: [], f: [] };
    dirs++;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { errors++; return node; }
    const fl = [];
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        const ch = walk(full, e.name);
        node.d.push(ch);
        node.s += ch.s; node.c += ch.c;
        if (ch.m > node.m) node.m = ch.m;
      } else if (e.isFile()) {
        let st;
        try { st = fs.statSync(full); } catch { errors++; continue; }
        const size = st.size, m = Math.floor(st.mtimeMs / 1000);
        fl.push([e.name, size, m]);
        files++; bytes += size;
        node.s += size; node.c++;
        if (m > node.m) node.m = m;
        const x = extOf(e.name);
        const rec = ext.get(x);
        if (rec) { rec[0]++; rec[1] += size; } else ext.set(x, [1, size]);
        const b = bucket(m); age[b] += size; agen[b]++;
        if (size > topMin) {
          top.push([full, size, m]);
          if (top.length > TOP * 4) {
            top.sort((a, b2) => b2[1] - a[1]); top.length = TOP; topMin = top[TOP - 1][1];
          }
        }
        if ((++tick & 255) === 0) {
          const t = Date.now();
          if (t - lastPost > 120) { lastPost = t; post({ t: 'p', f: files, d: dirs, b: bytes, cur: dir }); }
        }
      }
    }
    fl.sort((a, b) => b[1] - a[1]);
    if (fl.length > keep) {
      for (let i = keep; i < fl.length; i++) { node.rc++; node.rs += fl[i][1]; }
      fl.length = keep;
    }
    node.f = fl;
    node.d.sort((a, b) => b.s - a.s);
    return node;
  }

  const tree = walk(root, root);
  top.sort((a, b) => b[1] - a[1]); top.length = Math.min(top.length, TOP);
  const extArr = [...ext].map(([k, v]) => [k, v[0], v[1]]).sort((a, b) => b[2] - a[2]);
  done({ t: 'r', root: tree, ext: extArr, age, agen, top, files, dirs, bytes, errors, ms: Date.now() - started, engine: 'node' });
}

/* ------------------------------------------------------------ duplicates */
// Folders that hold installed programs, tools, caches and build output. Identical files in them are
// normal (every app ships its own copy) and removing one breaks that app — never offer them.
const PROTECTED_DIRS = new Set([
  'appdata', 'program files', 'program files (x86)', 'programdata', 'windows', '$recycle.bin', 'system volume information',
  'recovery', 'msocache', 'node_modules', '.git', '.svn', '.cargo', '.rustup', '.local', '.cache', '.codex', '.vscode', '.cursor',
  '.npm', '.pnpm-store', '.nuget', '.gradle', '.m2', '.conda', 'anaconda3', 'miniconda3', '.venv', 'venv', 'site-packages',
  '__pycache__', 'target', 'dist', 'build', 'out', 'bin', 'obj', 'packages', 'package cache', 'steamapps', 'windowsapps',
]);
// Program parts: executables, libraries, engine data. Deleting a "duplicate" of these breaks software.
const PROTECTED_EXT = new Set([
  '.exe', '.dll', '.sys', '.msi', '.msix', '.appx', '.node', '.so', '.dylib', '.pak', '.dat', '.asar', '.bin', '.lib', '.rmeta',
  '.rlib', '.pdb', '.jar', '.pyd', '.ocx', '.drv', '.cab', '.wasm', '.tflite', '.onnx', '.pack',
]);
const isProtectedPath = (p) => p.toLowerCase().split(/[\\/]+/).some((seg) => PROTECTED_DIRS.has(seg));

function dupes({ root, minSize = 1024 * 1024 }) {
  if (isProtectedPath(root)) { done({ groups: [], scanned: 0, protectedRoot: true }); return; }
  const list = [];
  const stack = [root];
  let seen = 0, last = 0, skippedDirs = 0;
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (PROTECTED_DIRS.has(e.name.toLowerCase())) skippedDirs++;
        else stack.push(full);
      } else if (e.isFile()) {
        seen++;
        if (PROTECTED_EXT.has(path.extname(e.name).toLowerCase())) continue;
        try {
          const st = fs.statSync(full);
          // online-only OneDrive placeholder: size is reported but nothing is on disk — hashing it would download the whole file
          if (st.size >= 65536 && st.blocks === 0) continue;
          if (st.size >= minSize) list.push([full, st.size, Math.floor(st.mtimeMs / 1000)]);
        } catch { /* unreadable */ }
        if ((seen & 511) === 0 && Date.now() - last > 150) { last = Date.now(); post({ t: 'p', phase: 'walk', done: seen, cur: dir }); }
      }
    }
  }
  const bySize = new Map();
  for (const f of list) { const a = bySize.get(f[1]); if (a) a.push(f); else bySize.set(f[1], [f]); }
  const cands = [...bySize.values()].filter((a) => a.length > 1);
  const PART = 64 * 1024;
  const buf = Buffer.allocUnsafe(4 * 1024 * 1024);

  const partial = (p, size) => {
    const fd = fs.openSync(p, 'r');
    try {
      const h = crypto.createHash('sha1');
      let n = fs.readSync(fd, buf, 0, Math.min(PART, size), 0);
      h.update(buf.subarray(0, n));
      if (size > PART * 2) { n = fs.readSync(fd, buf, 0, PART, size - PART); h.update(buf.subarray(0, n)); }
      return h.digest('hex');
    } finally { fs.closeSync(fd); }
  };
  let hashed = 0, total = 0;
  const full = (p) => {
    const fd = fs.openSync(p, 'r');
    try {
      const h = crypto.createHash('sha1');
      let n;
      while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
        h.update(buf.subarray(0, n));
        hashed += n;
        if (Date.now() - last > 150) { last = Date.now(); post({ t: 'p', phase: 'hash', done: hashed, total, cur: p }); }
      }
      return h.digest('hex');
    } finally { fs.closeSync(fd); }
  };

  const stage2 = [];
  for (const group of cands) {
    const m = new Map();
    for (const f of group) {
      try { const k = partial(f[0], f[1]); const a = m.get(k); if (a) a.push(f); else m.set(k, [f]); } catch { /* skip */ }
    }
    for (const a of m.values()) if (a.length > 1) { stage2.push(a); total += a[0][1] * a.length; }
  }
  const groups = [];
  for (const group of stage2) {
    const size = group[0][1];
    if (size <= PART * 2) { groups.push({ size, files: group.map((f) => ({ path: f[0], m: f[2] })) }); hashed += size * group.length; continue; }
    const m = new Map();
    for (const f of group) {
      try { const k = full(f[0]); const a = m.get(k); if (a) a.push(f); else m.set(k, [f]); } catch { /* skip */ }
    }
    for (const a of m.values()) if (a.length > 1) groups.push({ size, files: a.map((f) => ({ path: f[0], m: f[2] })) });
  }
  groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));
  done({ groups: groups.slice(0, 500), scanned: seen, skippedDirs });
}

/* ---------------------------------------------------------------- search */
function search({ root, q = '', exts = null, minSize = 0, olderDays = 0, newerDays = 0, limit = 2000 }) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const extSet = exts ? new Set(exts) : null;
  const now = Date.now() / 1000;
  const needStat = true;
  const stack = [root];
  let scanned = 0, count = 0, last = 0, batch = [];
  const flush = () => { if (batch.length) { post({ t: 'hits', items: batch }); batch = []; } };
  outer:
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const full = join(dir, e.name);
      const isDir = e.isDirectory();
      if (isDir) stack.push(full);
      else if (!e.isFile()) continue;
      scanned++;
      const lower = e.name.toLowerCase();
      let ok = true;
      for (const t of terms) if (!lower.includes(t)) { ok = false; break; }
      if (ok && isDir && (extSet || minSize || olderDays || newerDays || !terms.length)) ok = false;
      if (ok && extSet && !extSet.has(extOf(e.name))) ok = false;
      if (ok) {
        let size = -1, m = 0;
        if (needStat) {
          try { const st = fs.statSync(full); size = isDir ? -1 : st.size; m = Math.floor(st.mtimeMs / 1000); } catch { ok = false; }
        }
        if (ok && !isDir) {
          if (size < minSize) ok = false;
          else if (olderDays && now - m < olderDays * DAY) ok = false;
          else if (newerDays && now - m > newerDays * DAY) ok = false;
        }
        if (ok) {
          batch.push([full, size, m, isDir ? 1 : 0]);
          if (++count >= limit) break outer;
        }
      }
      if ((scanned & 255) === 0 && Date.now() - last > 120) { last = Date.now(); flush(); post({ t: 'p', n: scanned, cur: dir }); }
    }
  }
  flush();
  done({ count, scanned, capped: count >= limit });
}

/* --------------------------------------------------------------- dirsize */
function sizeOf(root) {
  let size = 0, n = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) { try { size += fs.statSync(full).size; n++; } catch { /* skip */ } }
    }
  }
  return { size, n };
}

function dirsize({ paths }) {
  const out = [];
  paths.forEach((p, i) => {
    let r = { size: 0, n: 0 };
    if (p) { try { if (fs.existsSync(p)) r = sizeOf(p); } catch { /* skip */ } }
    out.push(r);
    post({ t: 'size', i, size: r.size, n: r.n });
  });
  done(out);
}

/* ----------------------------------------------------------------- clean */
function clean({ paths }) {
  let freed = 0, removed = 0, failed = 0;
  for (const root of paths) {
    let ents;
    try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const full = join(root, e.name);
      let sz = 0;
      try { sz = e.isDirectory() && !e.isSymbolicLink() ? sizeOf(full).size : fs.lstatSync(full).size; } catch { /* skip */ }
      try { fs.rmSync(full, { recursive: true, force: true, maxRetries: 0 }); if (fs.existsSync(full)) throw new Error('locked'); freed += sz; removed++; }
      catch { failed++; }
      post({ t: 'p', freed, removed, failed, cur: full });
    }
  }
  done({ freed, removed, failed });
}

const tasks = { scan, dupes, search, dirsize, clean };
try { tasks[workerData.kind](workerData.data); }
catch (err) { post({ t: 'error', error: String((err && err.message) || err) }); done(null); }
