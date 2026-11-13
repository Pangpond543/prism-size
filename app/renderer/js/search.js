// Search — live walk of the disk (always current), with size / type / age filters.
import { T } from './i18n.js';
import { state, bus, api, fmt, fmtNum, ago, esc, pathOf, displayName, CATS, catOf, rgb, findNode, select, toast } from './core.js';
import { icon } from './icons.js';
import { locate } from './dashboard.js';

let el, active = false, scope = null, hits = [], busy = false, scanned = 0, capped = false, timer = 0, runId = 0;
const f = { q: '', cat: '', min: 0, age: '' };

function shell() {
  const sc = scope || state.focus || state.root;
  el.innerHTML = `
  <div class="page-head appear"><div><h2>${T`ค้นหา`}</h2><p>${T`ค้นจากดิสก์จริงแบบสด ๆ ใน “`}<span id="sr-scope">${sc ? esc(pathOf(sc)) : '—'}</span>”</p></div></div>
  <div class="card glass appear" style="margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
    <label class="field wide">${icon('search')}<input id="sr-q" placeholder="${T`พิมพ์ชื่อไฟล์หรือโฟลเดอร์… (เว้นวรรคเพื่อค้นหลายคำ)`}" spellcheck="false" value="${esc(f.q)}"></label>
    <label class="field"><span class="muted">${T`ประเภท`}</span><select id="sr-cat"><option value="">${T`ทั้งหมด`}</option>${Object.entries(CATS).filter(([k]) => k !== 'other').map(([k, c]) => `<option value="${k}" ${f.cat === k ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
    <label class="field"><span class="muted">${T`ใหญ่กว่า`}</span><select id="sr-min">${[[0, T`ไม่จำกัด`], [1, '1 MB'], [10, '10 MB'], [100, '100 MB'], [1024, '1 GB']].map(([v, l]) => `<option value="${v}" ${f.min === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field"><span class="muted">${T`อายุ`}</span><select id="sr-age">${[['', T`ทั้งหมด`], ['n7', T`แก้ไขใน 7 วัน`], ['n30', T`แก้ไขใน 30 วัน`], ['o180', T`เก่ากว่า 6 เดือน`], ['o365', T`เก่ากว่า 1 ปี`], ['o730', T`เก่ากว่า 2 ปี`]].map(([v, l]) => `<option value="${v}" ${f.age === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <button class="pill-btn" id="sr-scopebtn" title="${T`ค้นในโฟลเดอร์ที่กำลังดูอยู่`}">${icon('focus')}<span>${T`ใช้โฟลเดอร์ที่กำลังดู`}</span></button>
  </div>
  <div class="card glass appear" style="--i:1"><h3 id="sr-status">${T`พิมพ์คำค้นหรือเลือกตัวกรองเพื่อเริ่ม`}</h3><div class="progress indet hidden" id="sr-bar" style="margin-bottom:10px"><i></i></div><div class="rows" id="sr-rows"></div></div>`;
  const kick = () => { clearTimeout(timer); timer = setTimeout(run, 260); };
  el.querySelector('#sr-q').oninput = (e) => { f.q = e.target.value; kick(); };
  el.querySelector('#sr-cat').onchange = (e) => { f.cat = e.target.value; kick(); };
  el.querySelector('#sr-min').onchange = (e) => { f.min = +e.target.value; kick(); };
  el.querySelector('#sr-age').onchange = (e) => { f.age = e.target.value; kick(); };
  el.querySelector('#sr-scopebtn').onclick = () => { scope = state.focus; el.querySelector('#sr-scope').textContent = pathOf(scope); kick(); };
  el.querySelector('#sr-rows').onclick = (e) => {
    const row = e.target.closest('[data-p]');
    if (!row) return;
    const p = row.dataset.p;
    if (e.target.closest('[data-open]')) api.invoke('fs:open', p);
    else if (e.target.closest('[data-reveal]')) api.invoke('fs:reveal', p);
    else if (e.target.closest('[data-locate]')) locate(p);
    else { const n = findNode(p); if (n && pathOf(n).toLowerCase() === p.toLowerCase()) select(n); else bus.emit('inspect:path', p); }
  };
  setTimeout(() => { const i = el.querySelector('#sr-q'); if (i) i.focus(); }, 300);
  rows(); status();
}

function status() {
  const s = el.querySelector('#sr-status'), b = el.querySelector('#sr-bar');
  if (!s) return;
  b.classList.toggle('hidden', !busy);
  if (busy) s.textContent = T`กำลังค้นหา… พบ ${fmtNum(hits.length)} รายการ (ตรวจแล้ว ${fmtNum(scanned)})`;
  else if (!f.q.trim() && !f.cat && !f.min && !f.age) s.textContent = T`พิมพ์คำค้นหรือเลือกตัวกรองเพื่อเริ่ม`;
  else s.innerHTML = `${T`พบ ${fmtNum(hits.length)} รายการ${capped ? T` (แสดงสูงสุด 2,000 — ลองเพิ่มตัวกรอง)` : ''}`} <small>${T`ตรวจ ${fmtNum(scanned)} รายการ · เรียงตามขนาด`}</small>`;
}

function rows() {
  const box = el.querySelector('#sr-rows');
  if (!box) return;
  const list = hits.slice().sort((a, b) => b[1] - a[1]).slice(0, 400);
  const max = Math.max(1, list.length ? list[0][1] : 1);
  box.innerHTML = list.map(([p, s, m, d]) => {
    const name = p.slice(p.lastIndexOf('\\') + 1);
    const c = d ? [170, 185, 245] : CATS[catOf(name)].color;
    return `<div class="row clickable" data-p="${esc(p)}">${d ? '' : `<i class="bar" style="width:${(s / max) * 100}%"></i>`}<i class="dot" style="background:${rgb(c)};border-radius:${d ? 50 : 30}%"></i><span class="name">${esc(name)}<span class="sub">${esc(p)}</span></span><span class="muted">${ago(m)}</span><span class="val" style="width:80px;text-align:right">${d ? T`<span class="muted">โฟลเดอร์</span>` : fmt(s)}</span><span class="acts">${d ? '' : `<button class="icon-btn" data-open title="${T`เปิด`}">${icon('open')}</button>`}<button class="icon-btn" data-locate title="${T`ดูตำแหน่งในต้นไม้`}">${icon('locate')}</button><button class="icon-btn" data-reveal title="${T`แสดงใน Explorer`}">${icon('reveal')}</button></span></div>`;
  }).join('') || (busy || (!f.q.trim() && !f.cat && !f.min && !f.age) ? '' : T`<div class="empty">ไม่พบรายการที่ตรงกับเงื่อนไข</div>`);
}

async function run() {
  const sc = scope || state.focus || state.root;
  if (!sc) return;
  const id = ++runId;
  hits = []; scanned = 0; capped = false;
  if (!f.q.trim() && !f.cat && !f.min && !f.age) { await api.invoke('search:cancel'); busy = false; rows(); status(); return; }
  busy = true; rows(); status();
  const opts = { root: pathOf(sc), q: f.q, minSize: f.min * 1024 * 1024, exts: f.cat ? CATS[f.cat].list : null, limit: 2000 };
  if (f.age[0] === 'n') opts.newerDays = +f.age.slice(1);
  if (f.age[0] === 'o') opts.olderDays = +f.age.slice(1);
  const res = await api.invoke('search:start', opts);
  if (id !== runId) return; // superseded by a newer query
  busy = false;
  if (res) { scanned = res.scanned; capped = res.capped; }
  if (active) { rows(); status(); }
}

export function initSearch() {
  el = document.getElementById('search');
  let pend = 0;
  api.on('search:msg', (m) => {
    if (!busy) return;
    if (m.t === 'hits') hits.push(...m.items); else if (m.t === 'p') scanned = m.n;
    if (!pend) pend = setTimeout(() => { pend = 0; if (active) { rows(); status(); } }, 180);
  });
  bus.on('search:request', (node) => { scope = node; bus.emit('view', 'search'); });
  bus.on('scanned', () => { scope = null; hits = []; });
  return {
    show() { active = true; shell(); },
    hide() { active = false; },
  };
}
