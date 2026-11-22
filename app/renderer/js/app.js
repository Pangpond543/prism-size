// Prism — bootstrap: shell, views, inspector, scan flow, keyboard.
import { T } from './i18n.js';
import {
  state, bus, api, prepare, fmt, fmtNum, fmtPct, pct, fmtDate, ago, esc, displayName, pathOf, isDir, childrenOf,
  colorOf, rgb, CATS, catOf, extOf, select, setFocus, undo, toast, hideCtx, floaty, moveNode, trashNode, renameNode,
  newFolder, showNodeMenu, fileCount, copyText, serialize, setTheme, savedTheme, setLook, savedLook, clamp, theme, remember, trashNodes, htmlBox, lang,
} from './core.js';
import { translateDom } from './i18n.js';
import { icon, hydrateIcons } from './icons.js';
import { startBackground } from './bg.js';
import { initTree } from './tree.js';
import { initTreemap } from './treemap.js';
import { initSunburst } from './sunburst.js';
import { initDashboard, ringSvg, animateRings } from './dashboard.js';
import { initApps } from './apps.js';
import { initCleaner } from './cleaner.js';
import { initSearch } from './search.js';
import { initShield } from './shield.js';

const $ = (id) => document.getElementById(id);
const views = {};
let themeIcon = () => {}, closeThemePop = () => {}, stale = false, scanStart = 0, scanTimer = 0, lastRoot = '';

/* ------------------------------------------------------------------ views */
function setView(v) {
  if (!views[v]) return;
  if (!state.root && ['tree', 'treemap', 'sunburst', 'dashboard'].includes(v)) v = state.view;
  const prev = state.view;
  if (views[prev] && prev !== v) views[prev].hide();
  state.view = v;
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === 'v-' + v));
  document.querySelectorAll('.dock-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('st-zoom').classList.toggle('hidden', v !== 'tree');
  views[v].show();
  hideCtx();
}
bus.on('view', setView);

/* ----------------------------------------------------------------- crumbs */
function renderCrumbs() {
  const box = $('crumbs');
  if (!state.focus) { box.innerHTML = T`<span class="crumb-size">เลือกไดรฟ์หรือโฟลเดอร์เพื่อเริ่มสแกน</span>`; return; }
  const chain = [];
  for (let n = state.focus; n; n = n.p) chain.unshift(n);
  box.innerHTML = '';
  chain.forEach((n, i) => {
    if (i) { const s = document.createElement('span'); s.className = 'crumb-sep'; s.textContent = '›'; box.appendChild(s); }
    const b = document.createElement('button');
    b.className = 'crumb' + (i === chain.length - 1 ? ' last' : '');
    b.textContent = displayName(n); b.title = pathOf(n);
    b.onclick = () => setFocus(n);
    b.oncontextmenu = (e) => { e.preventDefault(); showNodeMenu(n, e.clientX, e.clientY); };
    box.appendChild(b);
  });
  const s = document.createElement('span'); s.className = 'crumb-size'; s.textContent = fmt(state.focus.s);
  box.appendChild(s);
  box.scrollLeft = box.scrollWidth;
}
function since(ms) {
  const m = (Date.now() - ms) / 60000;
  if (m < 1.5) return T`เมื่อสักครู่`;
  if (m < 60) return T`${Math.round(m)} นาทีก่อน`;
  if (m < 60 * 36) return T`${Math.round(m / 60)} ชั่วโมงก่อน`;
  return T`${Math.round(m / 1440)} วันก่อน`;
}
function renderStatus() {
  const f = state.focus;
  $('st-text').textContent = f ? T`${displayName(f)} · ${fmt(f.s)} · ${fmtNum(f.c)} ไฟล์${state.savedAt ? T` · สแกน${since(state.savedAt)}` : ''}${stale ? T` · ข้อมูลอาจไม่ตรงแล้ว — กดอัปเดต` : ''}` : T`ยังไม่ได้สแกน`;
  $('btn-undo').disabled = !state.undo.length;
  $('btn-rescan').disabled = !state.root;
}

/* -------------------------------------------------------------- inspector */
const TEXT_EXT = new Set('txt md log csv json xml yml yaml ini cfg conf js ts jsx tsx py java c cpp h cs go rs php rb html css lua sh bat ps1 sql toml'.split(' '));
const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/').split('/').map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join('/');

function renderInspector(node) {
  document.body.classList.toggle('has-insp', !!node);
  if (!node) return;
  const body = $('insp-body'), dir = isDir(node), p = pathOf(node), c = colorOf(node), par = node.p, root = state.root;
  const cat = dir ? null : CATS[catOf(node.n)];
  const act = (id, ic, label, cls = '') => `<button class="pill-btn ${cls}" data-act="${id}">${icon(ic)}<span>${label}</span></button>`;
  const kids = dir ? childrenOf(node).slice(0, 8) : [];
  const many = state.multi.size > 1 ? [...state.multi] : null;
  body.innerHTML = `
    ${many ? `<div class="multi-note"><span>${T`เลือกอยู่ ${many.length} รายการ · ${fmt(many.reduce((a, o) => a + o.s, 0))}`}</span><button class="pill-btn small warn" id="multi-del">${icon('trash')}<span>${T`ลบทั้งหมด`}</span></button></div>` : ''}
    <div class="insp-hero"><div class="insp-orb ${dir ? '' : 'file'}" style="--c:${rgb(c)}"></div>
      <div style="min-width:0"><div class="insp-name">${esc(displayName(node))}</div><div class="insp-kind">${dir ? T`โฟลเดอร์` : `${cat.label}${extOf(node.n) ? ' · .' + esc(extOf(node.n)) : ''}`}</div></div></div>
    <div class="insp-size">${fmt(node.s)}</div>
    <div class="insp-meters">
      ${par ? `<div class="meter">${T`${fmtPct(node.s, par.s)} ของ “${esc(displayName(par))}”`}<div class="meter-track"><div class="meter-fill" data-w="${pct(node.s, par.s)}%"></div></div></div>` : ''}
      ${root && !node.pseudo && node !== root ? `<div class="meter">${T`${fmtPct(node.s, root.s)} ของทั้งหมดที่สแกน`}<div class="meter-track"><div class="meter-fill" data-w="${pct(node.s, root.s)}%"></div></div></div>` : ''}
    </div>
    <dl class="kv">
      ${dir && !node.pseudo ? `<dt>${T`ไฟล์ทั้งหมด`}</dt><dd>${fmtNum(node.c)}</dd><dt>${T`อยู่ข้างในโดยตรง`}</dt><dd>${T`${fmtNum(node.d.length)} โฟลเดอร์ · ${fmtNum(fileCount(node))} ไฟล์`}</dd>` : ''}
      <dt>${dir ? T`กิจกรรมล่าสุด` : T`แก้ไขล่าสุด`}</dt><dd>${node.m ? `${fmtDate(node.m)} (${ago(node.m)})` : '—'}</dd>
    </dl>
    <div class="insp-path">${esc(p)}</div>
    <div id="insp-prev"></div>
    <div class="insp-actions">
      ${dir ? (node !== state.focus && !node.pseudo ? act('focus', 'focus', T`เจาะเข้าไปดู`, 'primary') : '') : act('open', 'open', T`เปิดไฟล์`, 'primary')}
      ${act('reveal', 'reveal', 'Explorer')}
      ${act('av', 'shield', T`สแกนไวรัส`)}
      ${act('copy', 'copy', T`คัดลอกพาธ`)}
      ${par && par.p ? act('up', 'up', T`ย้ายออกไปชั้นนอก`) : ''}
      ${dir && !node.pseudo ? act('mk', 'newfolder', T`โฟลเดอร์ใหม่`) : ''}
      ${par ? act('ren', 'edit', T`เปลี่ยนชื่อ`) : ''}
      ${par ? act('del', 'trash', T`ถังรีไซเคิล`, 'warn') : ''}
    </div>
    ${kids.length ? `<div class="insp-sub">${T`ใหญ่ที่สุดข้างใน`}</div><div class="rows insp-children">${kids.map((k, i) => `<div class="row clickable" data-k="${i}"><i class="bar" style="width:${pct(k.s, kids[0].s)}%"></i><i class="dot" style="background:${rgb(colorOf(k))};border-radius:${k.file ? 30 : 50}%"></i><span class="name">${esc(k.n)}</span><span class="val">${fmt(k.s)}</span></div>`).join('')}</div>` : ''}`;
  animateRings(body);
  if (many) $('multi-del').onclick = () => trashNodes(many);
  body.querySelector('.insp-actions').onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    ({
      focus: () => setFocus(node), open: () => api.invoke('fs:open', p), reveal: () => api.invoke('fs:reveal', p),
      av: () => bus.emit('av:request', p), copy: () => copyText(p), up: () => moveNode(node, par.p), mk: () => newFolder(node),
      ren: () => renameNode(node), del: () => trashNode(node),
    })[b.dataset.act]();
  };
  body.querySelectorAll('[data-k]').forEach((r) => {
    const k = kids[+r.dataset.k];
    r.onclick = () => select(k);
    r.oncontextmenu = (e) => { e.preventDefault(); showNodeMenu(k, e.clientX, e.clientY); };
  });
  if (!dir) preview(node, p);
}

async function preview(node, p) {
  const box = $('insp-prev'), cat = catOf(node.n), ext = extOf(node.n);
  let html = '';
  if (cat === 'image' && !['psd', 'ai', 'raw', 'heic', 'tif', 'tiff'].includes(ext) && node.s < 80 * 1024 * 1024) html = `<img src="${fileUrl(p)}" alt="">`;
  else if (cat === 'video' && ['mp4', 'webm', 'm4v', 'mov', 'mkv'].includes(ext)) html = `<video src="${fileUrl(p)}" controls muted preload="metadata"></video>`;
  else if (cat === 'audio' && ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'opus', 'aac'].includes(ext)) html = `<audio src="${fileUrl(p)}" controls preload="none"></audio>`;
  else if (TEXT_EXT.has(ext)) {
    const r = await api.invoke('fs:readText', p);
    if (state.selected !== node) return;
    if (r && r.text) html = `<pre>${esc(r.text.slice(0, 6000))}</pre>`;
  }
  if (html && state.selected === node) box.innerHTML = `<div class="insp-preview">${html}</div>`;
}

bus.on('select', renderInspector);
bus.on('inspect:path', async (p) => {
  const st = await api.invoke('fs:stat', p);
  if (!st) { toast(T`ไม่พบไฟล์นี้แล้ว`, { kind: 'err' }); return; }
  state.selected = st.dir ? { n: p, s: 0, c: 0, m: st.m, d: [], f: [], rc: 0, rs: 0, pseudo: true } : { n: p, s: st.size, m: st.m, file: true, pseudo: true };
  bus.emit('select', state.selected);
});
bus.on('focus', () => { stale = stale && true; renderCrumbs(); renderStatus(); });
bus.on('model', () => { renderCrumbs(); renderStatus(); });
bus.on('undo', renderStatus);
bus.on('stale', () => { stale = true; renderStatus(); });

/* ---------------------------------------------------------------- welcome */
async function showWelcome() {
  document.body.classList.add('welcoming');
  $('welcome').classList.remove('out');
  select(null);
  const [drives, sys, saved] = await Promise.all([api.invoke('drives:list'), state.sys || api.invoke('sys:info'), api.invoke('cache:list')]);
  state.sys = sys;
  $('saved-wrap').classList.toggle('hidden', !saved.length);
  $('saved-cards').innerHTML = saved.slice(0, 8).map((c, i) => `
    <div class="saved-card glass appear" style="--i:${i}" data-root="${esc(c.root)}" data-files="${c.files || 0}" title="${esc(c.root)}">
      ${icon('clock')}
      <div class="saved-main"><b>${esc(/^[a-zA-Z]:\\?$/.test(c.root) ? T`ไดรฟ์ ${c.root.slice(0, 2)}` : c.root.replace(/[\\/]+$/, '').split(/[\\/]/).pop())}</b><span>${T`${fmt(c.bytes)} · ${fmtNum(c.files)} ไฟล์ · สแกน${since(c.at)}`}</span></div>
      <button class="icon-btn" data-forget title="${T`ลบผลสแกนที่บันทึกไว้นี้`}">${icon('x')}</button>
    </div>`).join('');
  document.querySelectorAll('#saved-cards .saved-card').forEach((el) => {
    el.onclick = async (e) => {
      if (e.target.closest('[data-forget]')) { await api.invoke('cache:delete', el.dataset.root); showWelcome(); return; }
      const big = +el.dataset.files > BIG_SCAN;
      if (big) {
        toast(T`กำลังเปิดผลสแกนขนาดใหญ่ (${fmtNum(+el.dataset.files)} ไฟล์) — อาจใช้เวลาประมาณ 1 นาที โปรแกรมจะหน่วงช่วงนี้`, { duration: 60000 });
        await new Promise((r) => setTimeout(r, 120));
      }
      if (!(await loadSaved(el.dataset.root, big))) toast(T`เปิดผลสแกนที่บันทึกไว้ไม่ได้ — ลองสแกนใหม่`, { kind: 'err' });
    };
  });
  $('drive-cards').innerHTML = drives.map((d, i) => `
    <button class="drive-card glass appear" style="--i:${i}" data-path="${esc(d.root)}">
      <div class="ring">${ringSvg(d.used / d.total, 'wg' + i)}<b>${Math.round((d.used / d.total) * 100)}%</b></div>
      <div><div class="drive-name">${T`ไดรฟ์ ${d.root.slice(0, 2)}`}</div><div class="drive-meta">${T`ใช้ไป ${fmt(d.used)} จาก ${fmt(d.total)}`}</div><div class="drive-meta">${T`เหลือว่าง ${fmt(d.free)}`}</div></div>
    </button>`).join('');
  $('quick-cards').innerHTML = sys.quick.map((q, i) => `<button class="quick-card glass appear" style="--i:${i + 2}" data-path="${esc(q.path)}" title="${esc(q.path)}">${icon(q.icon)}<span>${esc(q.label)}</span></button>`).join('')
    + `<button class="quick-card glass appear" style="--i:${sys.quick.length + 2}" id="pick-folder">${icon('folder')}<span>${T`เลือกโฟลเดอร์อื่น…`}</span></button>`
    + (state.root ? `<button class="quick-card glass appear" style="--i:${sys.quick.length + 3}" id="back-view">${icon('undo')}<span>${T`กลับไปดูผลสแกนเดิม`}</span></button>` : '');
  $('engine-note').textContent = sys.rust ? T`ตัวสแกน: Rust แบบขนานหลายคอร์ (เร็วสูงสุด)` : T`ตัวสแกน: Node (ใช้งานได้ทันที) — ติดตั้ง Rust แล้วรัน “npm run build:scanner” เพื่อสแกนเร็วขึ้นหลายเท่า`;
  animateRings($('welcome'));
  document.querySelectorAll('#welcome [data-path]').forEach((b) => { b.onclick = () => startScan(b.dataset.path); });
  $('pick-folder').onclick = async () => { const p = await api.invoke('dialog:pickFolder', T`เลือกโฟลเดอร์`); if (p) startScan(p); };
  if ($('back-view')) $('back-view').onclick = hideWelcome;
}
function hideWelcome() { $('welcome').classList.add('out'); document.body.classList.remove('welcoming'); }

/* ------------------------------------------------------------------- scan */
async function startScan(path) {
  lastRoot = path;
  $('welcome').classList.add('out');
  $('scanning').classList.remove('hidden', 'out');
  document.body.classList.add('welcoming');
  $('sc-size').textContent = '0 B'; $('sc-files').textContent = '0'; $('sc-dirs').textContent = '0'; $('sc-path').textContent = path;
  scanStart = performance.now();
  clearInterval(scanTimer);
  scanTimer = setInterval(() => { $('sc-time').textContent = ((performance.now() - scanStart) / 1000).toFixed(1) + 's'; }, 100);
  const res = await api.invoke('scan:start', path);
  clearInterval(scanTimer);
  $('scanning').classList.add('hidden');
  if (!res || res.cancelled || res.error) {
    if (res && res.error) toast(res.error, { kind: 'err' });
    if (state.root) hideWelcome(); else showWelcome();
    return;
  }
  adopt(res);
  toast(T`สแกนเสร็จ — ${fmt(res.bytes)} ใน ${fmtNum(res.files)} ไฟล์ (${(res.ms / 1000).toFixed(1)} วินาที) · บันทึกไว้แล้ว`);
}

// put a scan result (fresh or loaded from the saved cache) on screen
function adopt(res) {
  const root = res.root;
  prepare(root);
  state.root = root; state.focus = root; state.selected = null; state.multi = new Set(); state.undo = [];
  state.meta = { ext: res.ext, age: res.age, agen: res.agen, top: res.top, files: res.files, dirs: res.dirs, bytes: res.bytes, errors: res.errors, ms: res.ms, engine: res.engine };
  state.savedAt = res.savedAt || Date.now();
  lastRoot = root.n; remember('prism.lastRoot', root.n);
  stale = false; dirtyCache = false;
  hideWelcome();
  bus.emit('scanned'); bus.emit('select', null); bus.emit('focus', root);
  if (!['tree', 'treemap', 'sunburst', 'dashboard'].includes(state.view)) state.view = 'tree';
  setView(state.view);
  const hint = document.querySelector('.view-hint');
  hint.classList.remove('fade'); setTimeout(() => hint.classList.add('fade'), 12000);
}
// Saved scans bigger than this are not reopened automatically — loading ~1.5M files blocks the UI for about a minute.
const BIG_SCAN = 400000;
async function loadSaved(root, quiet) {
  const res = await api.invoke('cache:load', root);
  if (!res || !res.root) return false;
  adopt(res);
  if (!quiet) toast(T`เปิดผลสแกนที่บันทึกไว้ (สแกน${since(state.savedAt)}) — กด “อัปเดต” เพื่อสแกนใหม่`, { label: T`อัปเดต`, action: () => startScan(lastRoot) });
  return true;
}

// moves / deletes / renames change the model → keep the saved copy in step
let dirtyCache = false, cacheTimer = 0;
function flushCache() {
  clearTimeout(cacheTimer);
  if (!dirtyCache || !state.root) return Promise.resolve();
  dirtyCache = false;
  return api.invoke('cache:save', { root: serialize(state.root), ...state.meta, savedAt: state.savedAt });
}
bus.on('model', () => { if (!state.root) return; dirtyCache = true; clearTimeout(cacheTimer); cacheTimer = setTimeout(flushCache, 4000); });

/* ------------------------------------------------------------ about/update */
const AUTHOR = 'Thanakorn Damrikitjaroen', MODEL = 'Claude Fable 5.2';
const PURPOSE = 'Prism Size turns your disk into a living glass map — see what takes up space at a glance, and tidy real files by simply dragging them.';
async function showInfo() {
  const info = await api.invoke('about:info');
  const link = info.repo ? `https://github.com/${info.repo}` : '';
  htmlBox(`
    <div class="about">
      <div class="prism-logo big"><i></i><i></i><i></i><b class="lg"><svg viewBox="18 18 64 64" aria-hidden="true"><path d="M47 31 A21 21 0 1 0 68 52 H47 Z" fill="#fff"/><path d="M53 25 A21 21 0 0 1 74 46 H53 Z" fill="#fff"/></svg></b></div>
      <h3>Prism Size <small>v${esc(info.version)}</small></h3>
      <p class="about-purpose">${esc(PURPOSE)}</p>
      <dl class="kv">
        <dt>${T`เวอร์ชัน`}</dt><dd>${esc(info.version)} · Electron ${esc(info.electron)}${info.rust ? ' · Rust scanner' : ''}</dd>
        <dt>${T`ผู้พัฒนา`}</dt><dd>${AUTHOR}</dd>
        <dt>${T`โมเดล AI ที่สร้าง`}</dt><dd>${MODEL}</dd>
        <dt>GitHub</dt><dd>${link ? `<a href="#" id="about-repo">${esc(link)}</a>` : T`<span class="muted">ยังไม่ได้ตั้งค่าลิงก์</span>`}</dd>
      </dl>
      <div class="about-update" id="about-update"><span class="muted">${link ? T`กดเพื่อตรวจว่ามีเวอร์ชันใหม่บน GitHub หรือไม่` : T`ใส่ชื่อ repository ในไฟล์ prism.config.json (เช่น "owner/prism") เพื่อเปิดใช้การอัปเดต`}</span></div>
      <div class="modal-btns"><button class="pill-btn" data-x>${T`ปิด`}</button><button class="pill-btn primary" id="about-check">${icon('refresh')}<span>${T`ตรวจหาอัปเดต`}</span></button></div>
    </div>`, (m, close) => {
    const box = m.querySelector('#about-update'), btn = m.querySelector('#about-check');
    const say = (html) => { box.innerHTML = html; };
    const why = (r) => ({
      norepo: T`ยังไม่ได้ตั้งค่าลิงก์ GitHub — ใส่ชื่อ repository ในไฟล์ prism.config.json`,
      notfound: T`ไม่พบ repository นี้บน GitHub`, noversion: T`repository นี้ยังไม่มีเลขเวอร์ชัน`,
      network: T`เชื่อมต่อ GitHub ไม่ได้ — ตรวจอินเทอร์เน็ตแล้วลองใหม่`, uptodate: T`เป็นเวอร์ชันล่าสุดอยู่แล้ว`,
      extract: T`แตกไฟล์อัปเดตไม่สำเร็จ`, layout: T`ไฟล์อัปเดตมีโครงสร้างไม่ถูกต้อง`, notprism: T`ไฟล์ที่ดาวน์โหลดมาไม่ใช่โปรแกรม Prism`,
      noasset: T`เวอร์ชันใหม่ยังไม่มีไฟล์ติดตั้งสำหรับ Windows`,
    }[r.reason] || T`เกิดข้อผิดพลาดระหว่างอัปเดต`);
    m.querySelector('[data-x]').onclick = () => close(null);
    if (link) m.querySelector('#about-repo').onclick = (e) => { e.preventDefault(); api.invoke('about:openRepo'); };
    const off = api.on('update:step', ({ step, f: frac }) => {
      const label = { download: T`กำลังดาวน์โหลด`, extract: T`กำลังแตกไฟล์`, copy: T`กำลังติดตั้ง`, build: T`กำลังคอมไพล์ตัวสแกน Rust` }[step] || step;
      say(`<span>${label}${step === 'download' && frac ? ` ${Math.round(frac * 100)}%` : '…'}</span><div class="progress indet"><i></i></div>`);
    });
    const apply = async () => {
      btn.disabled = true;
      say(T`<span>กำลังดาวน์โหลด…</span><div class="progress indet"><i></i></div>`);
      await flushCache();
      const r = await api.invoke('update:apply');
      if (!r.ok) { say(`<span class="bad">${esc(why(r))}</span>`); btn.disabled = false; return; }
      say(`<span class="good">${T`ติดตั้งเวอร์ชัน ${esc(r.version)} แล้ว — เริ่มโปรแกรมใหม่เพื่อใช้งาน`}</span>`);
      btn.innerHTML = T`<span>เริ่มโปรแกรมใหม่</span>`; btn.disabled = false;
      btn.onclick = () => { off(); api.invoke('app:relaunch'); };
    };
    btn.onclick = async () => {
      btn.disabled = true;
      say(T`<span>กำลังตรวจสอบ…</span><div class="progress indet"><i></i></div>`);
      const r = await api.invoke('update:check');
      btn.disabled = false;
      if (!r.ok) { say(`<span class="bad">${esc(why(r))}</span>`); return; }
      if (!r.hasUpdate) { say(`<span class="good">${T`เป็นเวอร์ชันล่าสุดอยู่แล้ว (v${esc(r.current)})`}</span>`); return; }
      say(`<span class="good">${T`มีเวอร์ชันใหม่ v${esc(r.latest)} (ตอนนี้ใช้ v${esc(r.current)})`}</span>`);
      btn.innerHTML = `${icon('download')}<span>${T`อัปเดตเลย`}</span>`;
      btn.onclick = apply;
    };
  });
}

/* ------------------------------------------------------------------- boot */
async function boot() {
  translateDom(document.body);
  hydrateIcons();
  setLook(savedLook());
  setTheme(savedTheme());
  startBackground($('bg'));
  views.tree = initTree(); views.treemap = initTreemap(); views.sunburst = initSunburst(); views.dashboard = initDashboard();
  views.apps = initApps(); views.cleaner = initCleaner(); views.search = initSearch(); views.shield = initShield();

  document.querySelectorAll('.dock-btn').forEach((b) => { b.onclick = () => { if (document.body.classList.contains('welcoming') && state.root) hideWelcome(); setView(b.dataset.view); }; });
  $('win-min').onclick = () => api.invoke('win:min');
  $('win-max').onclick = () => api.invoke('win:max');
  $('win-close').onclick = () => api.invoke('win:close');
  $('btn-newscan').onclick = showWelcome;
  $('btn-info').onclick = showInfo;
  themeIcon = () => { $('btn-theme').firstElementChild.innerHTML = icon(theme.dark ? 'day' : 'moon'); };
  // appearance menu under the moon/sun: theme (light / dark) + style (glass / classic); picks apply at once, the menu stays open
  const pop = $('theme-pop'), tbtn = $('btn-theme');
  const syncPop = () => {
    pop.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', (b.dataset.mode === 'dark') === theme.dark));
    pop.querySelectorAll('[data-look]').forEach((b) => b.classList.toggle('on', (b.dataset.look === 'classic') === theme.classic));
  };
  closeThemePop = () => { pop.classList.add('hidden'); tbtn.classList.remove('open'); };
  tbtn.onclick = () => {
    if (!pop.classList.contains('hidden')) { closeThemePop(); return; }
    hideCtx(); syncPop();
    pop.classList.remove('hidden'); tbtn.classList.add('open');
    placePop();
  };
  const placePop = () => {
    const r = tbtn.getBoundingClientRect(), w = pop.offsetWidth;
    pop.style.left = clamp(r.right - w + 8, 8, innerWidth - w - 8) + 'px';
    pop.style.top = r.bottom + 12 + 'px';
  };
  pop.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { setTheme(b.dataset.mode === 'dark'); themeIcon(); syncPop(); }; });
  pop.querySelectorAll('[data-look]').forEach((b) => { b.onclick = () => { setLook(b.dataset.look === 'classic'); syncPop(); }; });
  addEventListener('pointerdown', (e) => { if (!pop.contains(e.target) && !tbtn.contains(e.target)) closeThemePop(); }, true);
  addEventListener('resize', () => { if (!pop.classList.contains('hidden')) placePop(); }); // snap / maximise: follow the button
  themeIcon();
  // language tube: switching reloads the window; the saved scan brings everything straight back
  const ls = $('lang-switch');
  ls.dataset.lang = lang;
  ls.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.lang === lang);
    b.onclick = async () => {
      if (b.dataset.lang === lang) return;
      ls.dataset.lang = b.dataset.lang;
      remember('prism.lang', b.dataset.lang); remember('prism.view', state.view);
      await flushCache();
      setTimeout(() => api.invoke('win:reload'), 260);
    };
  });
  // projection toggles (tree view)
  for (const k of ['media', 'icon']) {
    const b = $('proj-' + k);
    b.classList.toggle('on', state.proj[k]);
    b.onclick = () => { state.proj[k] = !state.proj[k]; b.classList.toggle('on', state.proj[k]); remember('prism.proj.' + k, state.proj[k] ? '1' : '0'); };
  }
  // drag regions are recomputed whenever the window changes size (stale regions swallow clicks on the bar)
  const redrag = () => { const tb = $('titlebar'); tb.classList.add('no-drag'); requestAnimationFrame(() => requestAnimationFrame(() => tb.classList.remove('no-drag'))); };
  addEventListener('resize', redrag); api.on('win:state', redrag);
  setInterval(renderStatus, 60000);
  addEventListener('beforeunload', () => { flushCache(); });
  $('btn-undo').onclick = undo;
  $('btn-rescan').onclick = () => { if (lastRoot) startScan(lastRoot); };
  $('insp-close').onclick = () => select(null);
  $('sc-cancel').onclick = () => api.invoke('scan:cancel');
  $('zoom-in').onclick = () => bus.emit('zoom', 1.35);
  $('zoom-out').onclick = () => bus.emit('zoom', 1 / 1.35);
  $('zoom-fit').onclick = () => bus.emit('zoom', 0);

  floaty($('dock'), document.querySelector('.dock-grip'));
  floaty($('statusbar'), document.querySelector('.st-grip'));
  floaty($('insp-wrap'), $('insp-handle'));

  api.on('scan:progress', (m) => {
    $('sc-size').textContent = fmt(m.b); $('sc-files').textContent = fmtNum(m.f); $('sc-dirs').textContent = fmtNum(m.d);
    if (m.cur) $('sc-path').textContent = m.cur;
  });
  api.on('scan:engine', (e) => { $('sc-engine').textContent = e === 'rust' ? T`Rust · ขนานหลายคอร์` : 'Node'; });

  // glass specular highlight follows the pointer
  addEventListener('pointermove', (e) => {
    const g = e.target.closest && e.target.closest('.glass');
    if (!g) return;
    const r = g.getBoundingClientRect();
    g.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    g.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });
  addEventListener('pointerdown', (e) => { if (!e.target.closest('#ctx')) hideCtx(); }, true);
  addEventListener('blur', hideCtx);
  addEventListener('contextmenu', (e) => { if (!e.target.closest('canvas, .row, .crumb')) e.preventDefault(); });

  addEventListener('keydown', (e) => {
    const typing = e.target.closest('input, textarea, select');
    if (e.key === 'Escape') { if (!$('theme-pop').classList.contains('hidden')) { closeThemePop(); return; } hideCtx(); if (!typing) select(null); return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); setView('search'); return; }
    if (e.key === 'F5') { e.preventDefault(); if (lastRoot) startScan(lastRoot); return; }
    if (typing || !$('modal').classList.contains('hidden')) return;
    const n = state.selected;
    if (e.key === 'Delete' && state.multi.size > 1) trashNodes([...state.multi]);
    else if (e.key === 'Delete' && n && n.p) trashNode(n);
    else if (e.key === 'F2' && n && n.p) renameNode(n);
    else if (e.key === 'Enter' && n && isDir(n) && !n.pseudo) setFocus(n);
    else if (e.key === 'Backspace' && state.focus && state.focus.p) setFocus(state.focus.p);
    else if (/^[1-8]$/.test(e.key) && !e.ctrlKey && !e.altKey) setView(['tree', 'treemap', 'sunburst', 'dashboard', 'apps', 'cleaner', 'search', 'shield'][+e.key - 1]);
  });

  renderCrumbs(); renderStatus();
  await showWelcome();

  // optional launch hooks: PRISM_AUTOSCAN=<folder> scans on start, PRISM_VIEW=<view> opens a view
  const env = state.sys.env;
  if (env.act.includes('proj')) { state.proj.media = state.proj.icon = true; $('proj-media').classList.add('on'); $('proj-icon').classList.add('on'); }
  if (env.act.includes('dark')) { setTheme(true); themeIcon(); }
  if (env.act.includes('light')) { setTheme(false); themeIcon(); }
  // full press sequence (pointerdown → click), so the close-on-outside-press listener is exercised too
  const press = (el) => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); el.click(); };
  if (env.act.includes('themepop')) { press($('btn-theme')); }
  if (env.act.includes('classic')) env.act.includes('themepop') ? press(document.querySelector('#theme-pop [data-look=classic]')) : setLook(true);
  if (env.act.includes('glass')) env.act.includes('themepop') ? press(document.querySelector('#theme-pop [data-look=glass]')) : setLook(false);
  if (env.autoscan) {
    await startScan(env.autoscan);
    if (env.view) setView(env.view);
    if (env.act && state.root) {
      const kids = childrenOf(state.root);
      if (env.act.includes('select') && kids[0]) select(kids[0]);
      if (env.act.includes('deep')) { // open a chain of folders, one after another
        let d = state.root, i = 0;
        const next = () => { d = d.d[0]; if (!d || i++ > 3) return; bus.emit('reveal', childrenOf(d)[0] || d); setTimeout(next, 1100); };
        setTimeout(next, 700);
      }
      if (env.act.includes('expand')) { const d = state.root.d[0]; if (d) setTimeout(() => bus.emit('reveal', childrenOf(d)[0] || d), 900); }
    }
  } else {
    // reopen on the last scan instead of making the user scan again
    if (!env.nocache) {
      const saved = await api.invoke('cache:list');
      let want = ''; try { want = localStorage.getItem('prism.lastRoot') || ''; } catch { /* ignore */ }
      const small = saved.filter((c) => (c.files || 0) <= BIG_SCAN);
      const pick = small.find((c) => c.root === want) || small[0];
      if (pick && await loadSaved(pick.root)) {
        let v = ''; try { v = localStorage.getItem('prism.view') || ''; localStorage.removeItem('prism.view'); } catch { /* ignore */ }
        if (v) setView(v);
      }
    }
    if (env.view) setView(env.view);
    if (env.act && env.act.includes('info')) showInfo();
    if (env.act && env.act.includes('updfake')) window.__prismUpdFake = true;
  }
}
boot().catch((err) => { console.error(err); });

/* >>> prism-update-nudge (tools/brand/apply-web.js) */
{
  // Checks GitHub quietly a few seconds after start (and every 6 h). New version → dot on Info + a chip that slides out
  // once per version; clicking either opens Info already showing "Update now".
  const btn = document.getElementById('btn-info'), SEEN = 'prism.updSeen';
  let found = null;
  const chipOut = (r) => {
    let seen = null; try { seen = localStorage.getItem(SEEN); } catch {}
    if (seen === r.latest || document.querySelector('.upd-chip')) return;
    const chip = document.createElement('button');
    chip.className = 'upd-chip';
    chip.innerHTML = `<i></i><span>${T`มีเวอร์ชันใหม่ v${esc(r.latest)}`}</span><u>${T`(ตอนนี้ v${esc(r.current)})`}</u><b>${T`อัปเดต`}</b>`;
    document.body.appendChild(chip);
    const place = () => { const b = btn.getBoundingClientRect(); chip.style.top = `${b.bottom + 10}px`; chip.style.right = `${Math.max(8, innerWidth - b.right - 6)}px`; };
    place(); addEventListener('resize', place);
    requestAnimationFrame(() => requestAnimationFrame(() => chip.classList.add('show')));
    const hide = () => { chip.classList.remove('show'); removeEventListener('resize', place); setTimeout(() => chip.remove(), 450); };
    chip.onclick = () => { hide(); btn.click(); };
    setTimeout(hide, 10000);
  };
  const check = async () => {
    let r; try { r = window.__prismUpdFake ? { ok: true, hasUpdate: true, latest: '9.9.9', current: '1.0.0' } : await api.invoke('update:check'); } catch { return; } // __prismUpdFake = test hook (PRISM_ACT updfake)
    if (!r || !r.ok || !r.hasUpdate) return;
    const fresh = !found || found.latest !== r.latest;
    found = r;
    btn.classList.add('has-update');
    if (fresh) btn.classList.remove('seen');
    btn.title = T`มีเวอร์ชันใหม่ v${r.latest} — กดเพื่ออัปเดต`;
    chipOut(r);
  };
  setTimeout(check, 4000);
  setInterval(check, 6 * 3600e3);
  btn.addEventListener('click', () => {
    if (!found) return;
    try { localStorage.setItem(SEEN, found.latest); } catch {}
    btn.classList.add('seen');
    document.querySelector('.upd-chip')?.classList.remove('show');
    const t0 = performance.now();
    const go = () => { const c = document.getElementById('about-check'); if (c && !c.disabled && c.isConnected) c.click(); else if (performance.now() - t0 < 2500) requestAnimationFrame(go); };
    requestAnimationFrame(go);
  });
}
/* <<< prism-update-nudge */
