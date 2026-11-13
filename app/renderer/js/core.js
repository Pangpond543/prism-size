// Shared state, data model, file operations and small UI primitives.
import { icon } from './icons.js';
import { T, tr, lang } from './i18n.js';
export { T, tr, lang };

// Text that comes back from the main process (errors, labels, hints) is translated on the way in.
const deepTr = (v) => {
  if (lang !== 'en' || !v || typeof v !== 'object') return v;
  for (const o of Array.isArray(v) ? v : [v]) {
    if (!o || typeof o !== 'object') continue;
    for (const k of ['error', 'label', 'hint']) if (typeof o[k] === 'string') o[k] = tr(o[k]);
    if (Array.isArray(o.quick)) deepTr(o.quick);
  }
  return v;
};
export const api = { invoke: (ch, ...a) => window.prism.invoke(ch, ...a).then(deepTr), on: window.prism.on };

const store = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
export const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

// colours the canvases need to follow the light / dark theme
export const theme = { dark: false, ink: '35,42,71', ink2: '74,83,118', paper: '255,255,255', branch: '255,255,255', dust: 1 };
export function setTheme(dark) {
  Object.assign(theme, dark
    ? { dark: true, ink: '236,240,255', ink2: '176,186,226', paper: '14,18,40', branch: '170,182,255', dust: 0.55 }
    : { dark: false, ink: '35,42,71', ink2: '74,83,118', paper: '255,255,255', branch: '255,255,255', dust: 1 });
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  remember('prism.theme', dark ? 'dark' : 'light');
  bus.emit('theme', dark);
}
export const savedTheme = () => store('prism.theme', 'light') === 'dark';
export const state = {
  root: null,      // scanned root (dir node)
  focus: null,     // dir node the visualisations are centred on
  selected: null,  // node shown in the inspector
  meta: null,      // scan-wide stats (ext / age / top / totals)
  view: 'tree',
  undo: [],
  sys: null,
  multi: new Set(), // every selected node (the tree lets you pick several)
  proj: { media: store('prism.proj.media', '0') === '1', icon: store('prism.proj.icon', '0') === '1' }, // projection toggles
  savedAt: 0,
};

/* ------------------------------------------------------------------ bus */
const listeners = new Map();
export const bus = {
  on(ev, fn) { (listeners.get(ev) || listeners.set(ev, []).get(ev)).push(fn); },
  emit(ev, ...a) { for (const fn of listeners.get(ev) || []) { try { fn(...a); } catch (err) { console.error(ev, err); } } },
};

/* ------------------------------------------------------------- formatting */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
export function fmt(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  let i = 0, v = bytes;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${UNITS[i]}`;
}
export const fmtNum = (n) => (n || 0).toLocaleString('en-US');
export const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
export const fmtPct = (a, b) => { const p = pct(a, b); return p >= 10 ? p.toFixed(0) + '%' : p >= 0.1 ? p.toFixed(1) + '%' : p > 0 ? '<0.1%' : '0%'; };
export function fmtDate(sec) {
  if (!sec) return '—';
  return new Date(sec * 1000).toLocaleDateString(lang === 'en' ? 'en-GB' : 'th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}
export function ago(sec) {
  if (!sec) return '—';
  const d = (Date.now() / 1000 - sec) / 86400;
  if (d < 1) return T`วันนี้`;
  if (d < 30) return T`${Math.floor(d)} วันก่อน`;
  if (d < 365) return T`${Math.floor(d / 30)} เดือนก่อน`;
  return T`${(d / 365).toFixed(1)} ปีก่อน`;
}
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const ease = (t) => 1 - Math.pow(1 - t, 3);

/* ----------------------------------------------------------- categories */
export const CATS = {
  video: { label: T`วิดีโอ`, color: [255, 150, 182], exts: 'mp4 mkv avi mov wmv flv webm m4v mpg mpeg ts' },
  image: { label: T`รูปภาพ`, color: [255, 190, 140], exts: 'jpg jpeg png gif bmp webp svg ico tif tiff heic raw psd ai' },
  audio: { label: T`เสียง`, color: [196, 160, 255], exts: 'mp3 wav flac aac ogg m4a wma opus mid' },
  doc: { label: T`เอกสาร`, color: [128, 188, 255], exts: 'pdf doc docx xls xlsx ppt pptx txt md rtf csv odt epub' },
  archive: { label: T`ไฟล์บีบอัด`, color: [255, 212, 118], exts: 'zip rar 7z tar gz bz2 xz iso cab img' },
  code: { label: T`โค้ด`, color: [118, 224, 190], exts: 'js ts jsx tsx py java c cpp h cs go rs php rb html css json xml yml yaml lua sh bat ps1 sql' },
  app: { label: T`โปรแกรม`, color: [150, 165, 255], exts: 'exe msi dll sys bin apk appx msix jar node pyd' },
  game: { label: T`ข้อมูลเกม`, color: [255, 160, 226], exts: 'pak unity3d assets bundle vpk wad rpf uasset umap rbxl bsp' },
  data: { label: T`ข้อมูล / แคช`, color: [146, 214, 236], exts: 'db sqlite dat log bak tmp cache vhdx vmdk pf etl asar' },
  other: { label: T`อื่น ๆ`, color: [198, 204, 224], exts: '' },
};
const EXT2CAT = new Map();
for (const [k, c] of Object.entries(CATS)) { c.list = c.exts.split(' ').filter(Boolean); for (const e of c.list) EXT2CAT.set(e, k); }
export function extOf(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1 || name.length - i - 1 > 10) return '';
  return name.slice(i + 1).toLowerCase();
}
export const catOfExt = (e) => EXT2CAT.get(e) || 'other';
export const catOf = (name) => catOfExt(extOf(name));

function hsl2rgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return [f(0), f(8), f(4)];
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function colorOf(node) {
  if (node._c) return node._c;
  let c;
  if (node.agg) c = [205, 210, 230];
  else if (node.file) c = CATS[catOf(node.n)].color;
  else c = hsl2rgb(190 + (hashStr(node.n) % 170), 0.78, 0.76); // folders: cyan → blue → violet → pink
  node._c = c;
  return c;
}
export const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

/* ------------------------------------------------------------ data model */
// dir node:  { n, s, c, m, rc, rs, d:[dir], f:[[name,size,mtime]], p }
// file node: { n, s, m, p, file:true }   (materialised lazily from dir.f)
export function prepare(root) {
  root.p = null;
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    for (const d of n.d) { d.p = n; stack.push(d); }
  }
}
export const isDir = (n) => !n.file && !n.agg;
export function filesOf(dir) {
  if (!dir._fo) { dir._fo = dir.f.map((a) => ({ n: a[0], s: a[1], m: a[2], p: dir, file: true })); dir.f = null; }
  return dir._fo;
}
export const fileCount = (dir) => (dir._fo ? dir._fo.length : dir.f.length) + (dir.rc || 0);
export function childrenOf(dir) {
  const out = dir.d.concat(filesOf(dir));
  out.sort((a, b) => b.s - a.s);
  return out;
}
export function pathOf(node) {
  const parts = [];
  let n = node;
  while (n.p) { parts.push(n.n); n = n.p; }
  let base = n.n;
  if (!parts.length) return base;
  if (!base.endsWith('\\')) base += '\\';
  return base + parts.reverse().join('\\');
}
export function displayName(node) {
  if (node.agg) return T`อีก ${fmtNum(node.count)} รายการ`;
  if (node.p) return node.n;
  const m = /([^\\/]+)[\\/]*$/.exec(node.n);
  return /^[a-zA-Z]:\\?$/.test(node.n) ? T`ไดรฟ์ ${node.n.slice(0, 2)}` : (m ? m[1] : node.n);
}
export function isAncestor(a, n) { for (let x = n; x; x = x.p) if (x === a) return true; return false; }
export function findNode(path) {
  const root = state.root;
  if (!root) return null;
  const base = root.n.replace(/[\\/]+$/, '').toLowerCase();
  const p = path.replace(/[\\/]+$/, '');
  if (p.toLowerCase() === base) return root;
  if (!p.toLowerCase().startsWith(base + '\\')) return null;
  const segs = p.slice(base.length + 1).split('\\');
  let cur = root;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i].toLowerCase();
    let next = cur.d.find((d) => d.n.toLowerCase() === s);
    if (!next && i === segs.length - 1) next = filesOf(cur).find((f) => f.n.toLowerCase() === s);
    if (!next) return i === segs.length - 1 ? cur : null; // file not among the kept ones → return its folder
    cur = next;
  }
  return cur;
}
export async function loadAllFiles(dir) {
  if (!dir.rc) return;
  const list = await api.invoke('fs:list', pathOf(dir));
  dir._fo = list.map((a) => ({ n: a[0], s: a[1], m: a[2], p: dir, file: true }));
  dir.f = null; dir.rc = 0; dir.rs = 0;
}

// plain-JSON copy of the live model, in the same shape the scanner produces (for the saved-scan cache)
export function serialize(root) {
  const conv = (n) => ({
    n: n.n, s: n.s, c: n.c, m: n.m, rc: n.rc || 0, rs: n.rs || 0,
    f: n._fo ? n._fo.map((x) => [x.n, x.s, x.m]) : n.f,
    d: n.d.map(conv),
  });
  return conv(root);
}

function bubble(dir, ds, dc) { for (let n = dir; n; n = n.p) { n.s += ds; n.c += dc; } }
function detach(node) {
  const p = node.p;
  if (!p) return;
  const arr = node.file ? filesOf(p) : p.d;
  const i = arr.indexOf(node);
  if (i >= 0) arr.splice(i, 1);
  bubble(p, -node.s, -(node.file ? 1 : node.c));
  node.p = null;
}
function attach(node, dest) {
  node.p = dest;
  const arr = node.file ? filesOf(dest) : dest.d;
  arr.push(node);
  arr.sort((a, b) => b.s - a.s);
  bubble(dest, node.s, node.file ? 1 : node.c);
}

/* -------------------------------------------------------- file operations */
function fixSelection(node) {
  state.multi.delete(node);
  if (state.selected && (state.selected === node || (!node.file && isAncestor(node, state.selected)))) select(null);
  if (state.focus && !node.file && node.p && isAncestor(node, state.focus)) setFocus(node.p);
}

export async function moveNode(node, dest, opts = {}) {
  if (!node.p || node.agg || !isDir(dest)) return false;
  if (dest === node.p && !opts.name) return false;
  if (!node.file && isAncestor(node, dest)) { toast(T`ย้ายโฟลเดอร์เข้าไปในตัวเองไม่ได้`, { kind: 'err' }); return false; }
  const oldParent = node.p, oldName = node.n;
  const r = await api.invoke('fs:move', { src: pathOf(node), destDir: pathOf(dest), name: opts.name });
  if (!r.ok) { toast(r.error, { kind: 'err' }); bus.emit('model'); return false; }
  detach(node);
  node.n = r.name; node._c = null;
  attach(node, dest);
  if (!opts.isUndo) {
    state.undo.push({ type: 'move', node, from: oldParent, name: oldName });
    if (!opts.quiet) toast(T`ย้าย “${node.n}” ไปที่ “${displayName(dest)}” แล้ว`, { label: T`ย้อนกลับ`, action: undo });
  }
  if (!opts.quiet) { bus.emit('model'); bus.emit('undo'); }
  if (state.selected === node) bus.emit('select', node);
  return true;
}

// drop nodes whose folder is already in the list (moving the folder moves them too)
const topLevel = (nodes) => nodes.filter((n) => n.p && !n.agg && !nodes.some((o) => o !== n && !o.file && isAncestor(o, n)));
export async function moveNodes(nodes, dest) {
  nodes = topLevel(nodes);
  if (nodes.length <= 1) return nodes.length ? moveNode(nodes[0], dest) : false;
  let done = 0;
  for (const n of nodes) if (await moveNode(n, dest, { quiet: true })) done++;
  bus.emit('model'); bus.emit('undo');
  if (done) toast(T`ย้าย ${done} รายการไปที่ “${displayName(dest)}” แล้ว`, { label: T`ย้อนกลับ`, action: async () => { for (let i = 0; i < done; i++) await undo(true); } });
  return done > 0;
}
export async function trashNodes(nodes) {
  nodes = topLevel(nodes);
  if (nodes.length <= 1) return nodes.length ? trashNode(nodes[0]) : false;
  const total = nodes.reduce((a, n) => a + n.s, 0);
  if (!(await confirmBox(T`ย้าย ${nodes.length} รายการไปถังรีไซเคิล?`, T`รวม ${fmt(total)} — กู้คืนได้จากถังรีไซเคิล`, T`ย้ายไปถังรีไซเคิล`, true))) return false;
  let done = 0;
  for (const n of nodes) if (await trashNode(n, { quiet: true })) done++;
  bus.emit('model');
  if (done) toast(T`ย้าย ${done} รายการไปถังรีไซเคิลแล้ว`, { label: T`เปิดถังรีไซเคิล`, action: () => api.invoke('fs:recycleBin') });
  return done > 0;
}

export async function trashNode(node, opts = {}) {
  if (!node.p || node.agg) return false;
  const name = node.n;
  const r = await api.invoke('fs:trash', pathOf(node));
  if (!r.ok) { toast(r.error, { kind: 'err' }); return false; }
  fixSelection(node);
  detach(node);
  if (opts.quiet) return true;
  toast(T`ย้าย “${name}” ไปถังรีไซเคิลแล้ว (${fmt(node.s)})`, { label: T`เปิดถังรีไซเคิล`, action: () => api.invoke('fs:recycleBin') });
  bus.emit('model');
  return true;
}

export async function renameNode(node) {
  if (!node.p) return;
  const name = await promptBox(T`เปลี่ยนชื่อ`, node.n, T`บันทึก`);
  if (!name || name === node.n) return;
  const old = node.n;
  const r = await api.invoke('fs:rename', { src: pathOf(node), name });
  if (!r.ok) { toast(r.error, { kind: 'err' }); return; }
  node.n = r.name; node._c = null;
  state.undo.push({ type: 'rename', node, name: old });
  toast(T`เปลี่ยนชื่อเป็น “${name}” แล้ว`, { label: T`ย้อนกลับ`, action: undo });
  bus.emit('model'); bus.emit('undo');
  if (state.selected === node) bus.emit('select', node);
}

export async function newFolder(dir) {
  const name = await promptBox(T`สร้างโฟลเดอร์ใหม่ใน “${displayName(dir)}”`, T`โฟลเดอร์ใหม่`, T`สร้าง`);
  if (!name) return;
  const r = await api.invoke('fs:mkdir', { dir: pathOf(dir), name });
  if (!r.ok) { toast(r.error, { kind: 'err' }); return; }
  const node = { n: r.name, s: 0, c: 0, m: Math.floor(Date.now() / 1000), rc: 0, rs: 0, d: [], f: [], p: dir };
  dir.d.push(node);
  toast(T`สร้างโฟลเดอร์ “${name}” แล้ว — ลากไฟล์มาวางได้เลย`);
  bus.emit('model');
  bus.emit('reveal', node);
}

export async function undo(quiet) {
  const op = state.undo.pop();
  bus.emit('undo');
  if (!op) return;
  if (op.type === 'move') {
    if (!op.from || (op.from !== state.root && !isAncestor(state.root, op.from))) { toast(T`ย้อนกลับไม่ได้ — โฟลเดอร์เดิมไม่อยู่แล้ว`, { kind: 'err' }); return; }
    const ok = await moveNode(op.node, op.from, { name: op.name, isUndo: true });
    if (ok && quiet !== true) toast(T`ย้อนกลับแล้ว — “${op.node.n}” กลับไปอยู่ที่ “${displayName(op.from)}”`);
  } else if (op.type === 'rename') {
    const r = await api.invoke('fs:rename', { src: pathOf(op.node), name: op.name });
    if (!r.ok) { toast(r.error, { kind: 'err' }); return; }
    op.node.n = r.name; op.node._c = null;
    toast(T`ย้อนกลับการเปลี่ยนชื่อแล้ว`);
    bus.emit('model');
    if (state.selected === op.node) bus.emit('select', op.node);
  }
}

/* -------------------------------------------------------- focus / select */
export function setFocus(node) {
  if (!node || !isDir(node)) return;
  state.focus = node;
  bus.emit('focus', node);
}
export function select(node, add = false) {
  if (node && node.agg) node = null;
  if (add && node) { // Ctrl+click: add / remove from the selection
    if (state.multi.has(node)) state.multi.delete(node); else state.multi.add(node);
    state.selected = state.multi.has(node) ? node : ([...state.multi].pop() || null);
  } else {
    state.multi = new Set(node ? [node] : []);
    state.selected = node || null;
  }
  bus.emit('select', state.selected);
}
export function selectMany(nodes) {
  state.multi = new Set(nodes);
  state.selected = nodes[0] || null;
  bus.emit('select', state.selected);
}
export function setView(v) { bus.emit('view', v); }

/* ------------------------------------------------------------ primitives */
const $ = (id) => document.getElementById(id);

export function toast(msg, opts = {}) {
  const el = document.createElement('div');
  el.className = 'toast glass' + (opts.kind === 'err' ? ' err' : '');
  el.innerHTML = `<i class="t-ico"></i><span class="t-msg">${esc(tr(msg))}</span>`;
  if (opts.action) {
    const b = document.createElement('button');
    b.className = 'pill-btn small'; b.textContent = opts.label || T`ตกลง`;
    b.onclick = () => { opts.action(); close(); };
    el.appendChild(b);
  }
  const close = () => { if (el.isConnected) { el.classList.add('out'); setTimeout(() => el.remove(), 400); } };
  $('toasts').appendChild(el);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  setTimeout(close, opts.action ? 9000 : 4500);
}

export function tooltip(html, x, y) {
  const t = $('tooltip');
  if (!html) { t.classList.add('hidden'); return; }
  t.innerHTML = html;
  t.classList.remove('hidden');
  const r = t.getBoundingClientRect();
  t.style.left = clamp(x + 18, 8, innerWidth - r.width - 8) + 'px';
  t.style.top = clamp(y + 18, 8, innerHeight - r.height - 8) + 'px';
}

export function ctxMenu(x, y, items, title) {
  const m = $('ctx');
  m.innerHTML = '';
  if (title) { const h = document.createElement('div'); h.className = 'ctx-head'; h.textContent = title; m.appendChild(h); }
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { const s = document.createElement('div'); s.className = 'ctx-sep'; m.appendChild(s); continue; }
    const b = document.createElement('button');
    b.className = 'ctx-item' + (it.danger ? ' danger' : '');
    b.innerHTML = `${icon(it.icon)}<span>${esc(it.label)}</span>`;
    b.onclick = () => { hideCtx(); it.run(); };
    m.appendChild(b);
  }
  m.classList.remove('hidden');
  const r = m.getBoundingClientRect();
  m.style.left = clamp(x, 8, innerWidth - r.width - 8) + 'px';
  m.style.top = clamp(y, 8, innerHeight - r.height - 8) + 'px';
}
export function hideCtx() { $('ctx').classList.add('hidden'); }

function modal(html, onMount) {
  return new Promise((resolve) => {
    const m = $('modal');
    m.innerHTML = `<div class="modal-card glass">${html}</div>`;
    m.classList.remove('hidden');
    const close = (v) => { m.classList.add('hidden'); m.innerHTML = ''; removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    addEventListener('keydown', onKey, true);
    m.onpointerdown = (e) => { if (e.target === m) close(null); };
    onMount(m, close);
  });
}
export function htmlBox(html, onMount) { return modal(html, onMount); }
export function confirmBox(title, msg, okLabel = T`ยืนยัน`, danger = false) {
  return modal(
    `<h3>${esc(title)}</h3><p>${esc(msg)}</p><div class="modal-btns"><button class="pill-btn" data-x>${T`ยกเลิก`}</button><button class="pill-btn ${danger ? 'warn' : 'primary'}" data-ok>${esc(okLabel)}</button></div>`,
    (m, close) => {
      m.querySelector('[data-x]').onclick = () => close(false);
      m.querySelector('[data-ok]').onclick = () => close(true);
      m.querySelector('[data-ok]').focus();
    }).then(Boolean);
}
export function promptBox(title, value = '', okLabel = T`ตกลง`) {
  return modal(
    `<h3>${esc(title)}</h3><label class="field"><input type="text" spellcheck="false"></label><div class="modal-btns"><button class="pill-btn" data-x>${T`ยกเลิก`}</button><button class="pill-btn primary" data-ok>${esc(okLabel)}</button></div>`,
    (m, close) => {
      const inp = m.querySelector('input');
      inp.value = value;
      const dot = value.lastIndexOf('.');
      inp.focus(); inp.setSelectionRange(0, dot > 0 ? dot : value.length);
      const ok = () => close(inp.value.trim() || null);
      inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
      m.querySelector('[data-x]').onclick = () => close(null);
      m.querySelector('[data-ok]').onclick = ok;
    });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  toast(T`คัดลอกพาธแล้ว`);
}

/* ----------------------------------------------------------- node menus */
export function nodeMenu(node) {
  const dir = isDir(node);
  const p = pathOf(node);
  return [
    !dir && { icon: 'open', label: T`เปิดไฟล์`, run: () => api.invoke('fs:open', p) },
    dir && node !== state.focus && { icon: 'focus', label: T`เจาะเข้าไปดูโฟลเดอร์นี้`, run: () => setFocus(node) },
    { icon: 'reveal', label: T`แสดงใน File Explorer`, run: () => api.invoke('fs:reveal', p) },
    { icon: 'copy', label: T`คัดลอกพาธ`, run: () => copyText(p) },
    '-',
    { icon: 'shield', label: dir ? T`สแกนไวรัสโฟลเดอร์นี้` : T`สแกนไวรัสไฟล์นี้`, run: () => bus.emit('av:request', p) },
    dir && { icon: 'copy', label: T`หาไฟล์ซ้ำในโฟลเดอร์นี้`, run: () => bus.emit('dupes:request', node) },
    dir && { icon: 'search', label: T`ค้นหาในโฟลเดอร์นี้`, run: () => bus.emit('search:request', node) },
    '-',
    dir && { icon: 'newfolder', label: T`สร้างโฟลเดอร์ใหม่ข้างใน`, run: () => newFolder(node) },
    node.p && node.p.p && { icon: 'up', label: T`ย้ายออกไปที่ “${displayName(node.p.p)}”`, run: () => moveNode(node, node.p.p) },
    node.p && { icon: 'edit', label: T`เปลี่ยนชื่อ`, run: () => renameNode(node) },
    node.p && { icon: 'trash', label: T`ย้ายไปถังรีไซเคิล`, danger: true, run: () => trashNode(node) },
  ];
}
export function showNodeMenu(node, x, y) {
  if (!node || node.agg) return;
  if (state.multi.size > 1 && state.multi.has(node)) { // several selected → act on all of them
    const nodes = [...state.multi], n = nodes.length;
    const up = nodes.every((o) => o.p && o.p.p && o.p === nodes[0].p) ? nodes[0].p.p : null;
    ctxMenu(x, y, [
      up && { icon: 'up', label: T`ย้าย ${n} รายการออกไปที่ “${displayName(up)}”`, run: () => moveNodes(nodes, up) },
      { icon: 'trash', label: T`ย้าย ${n} รายการไปถังรีไซเคิล`, danger: true, run: () => trashNodes(nodes) },
      '-',
      { icon: 'x', label: T`ยกเลิกการเลือก`, run: () => select(null) },
    ], T`เลือกอยู่ ${n} รายการ · ${fmt(nodes.reduce((a, o) => a + o.s, 0))}`);
    return;
  }
  select(node);
  ctxMenu(x, y, nodeMenu(node), displayName(node));
}

/* ----------------------------------------------- floating panels: inertia */
// free:    panel keeps drifting after release, decelerating like an object in space, soft-bounces off window edges
// elastic: panel springs back to where it belongs
export function floaty(el, handle, { elastic = false } = {}) {
  let x = 0, y = 0, vx = 0, vy = 0, tilt = 0, dragging = false, raf = 0, lx = 0, ly = 0, lt = 0, base = null;
  const apply = () => { el.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) rotate(${tilt.toFixed(3)}deg)`; };
  const bounds = () => {
    const r = el.getBoundingClientRect();
    base = { l: r.left - x, t: r.top - y, w: r.width, h: r.height };
  };
  const loop = () => {
    raf = 0;
    if (dragging) { tilt += (clamp(vx * 0.006, -5, 5) - tilt) * 0.2; apply(); raf = requestAnimationFrame(loop); return; }
    if (elastic) {
      vx += (-x * 0.085 - vx * 0.16); vy += (-y * 0.085 - vy * 0.16); // spring home (frame-based)
      x += vx * 0.016 * 9; y += vy * 0.016 * 9;
    } else {
      x += vx * 0.016; y += vy * 0.016;
      vx *= 0.945; vy *= 0.945;
      const m = 10;
      if (base.l + x < m) { x = m - base.l; vx = Math.abs(vx) * 0.55; }
      if (base.t + y < m) { y = m - base.t; vy = Math.abs(vy) * 0.55; }
      if (base.l + x + base.w > innerWidth - m) { x = innerWidth - m - base.w - base.l; vx = -Math.abs(vx) * 0.55; }
      if (base.t + y + base.h > innerHeight - m) { y = innerHeight - m - base.h - base.t; vy = -Math.abs(vy) * 0.55; }
    }
    tilt += (clamp(vx * 0.006, -5, 5) - tilt) * 0.14;
    apply();
    const moving = Math.abs(vx) + Math.abs(vy) > (elastic ? 0.02 : 4) || Math.abs(tilt) > 0.02 || (elastic && Math.abs(x) + Math.abs(y) > 0.3);
    if (moving) raf = requestAnimationFrame(loop);
    else { tilt = 0; if (elastic) { x = 0; y = 0; } apply(); }
  };
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, select, a')) return;
    dragging = true; bounds();
    lx = e.clientX; ly = e.clientY; lt = performance.now(); vx = vy = 0;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging-floaty');
    handle.style.cursor = 'grabbing';
    if (!raf) raf = requestAnimationFrame(loop);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const now = performance.now(), dt = Math.max(1, now - lt) / 1000;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    x += dx; y += dy;
    vx = vx * 0.6 + (dx / dt) * 0.4; vy = vy * 0.6 + (dy / dt) * 0.4;
    lx = e.clientX; ly = e.clientY; lt = now;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging-floaty');
    handle.style.cursor = '';
    if (performance.now() - lt > 80) vx = vy = 0; // held still before release → no throw
    if (elastic) { vx *= 0.02; vy *= 0.02; }
    if (!raf) raf = requestAnimationFrame(loop);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  addEventListener('resize', () => { if (!elastic && (x || y)) { bounds(); if (!raf) raf = requestAnimationFrame(loop); } });
}
