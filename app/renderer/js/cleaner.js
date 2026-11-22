// Cleaner — junk files, duplicates, big-and-old files, empty folders.
import { T } from './i18n.js';
import {
  state, bus, api, fmt, fmtNum, fmtDate, ago, esc, pct, toast, confirmBox, displayName, pathOf, findNode,
  isDir, fileCount, trashNode, trashPath, select, CATS, catOf, rgb,
} from './core.js';
import { icon } from './icons.js';
import { locate } from './dashboard.js';

let el, active = false, tab = 'junk';
let junk = null, junkBusy = false, junkSel = new Set();
let dupeInfo = null;
let dupes = null, dupeBusy = false, dupeRoot = null, dupeMin = 1, dupeProg = null, dupeSel = new Set();
const YEAR = 365 * 86400;

const emptyState = (ico, title, sub) => `<div class="empty"><div class="big-ico">${icon(ico)}</div><div style="font-weight:650;color:var(--ink-2);font-size:15px">${title}</div><div>${sub || ''}</div></div>`;

function render() {
  if (!active) return;
  el.innerHTML = `
  <div class="page-head appear"><div><h2>${T`ทำความสะอาด`}</h2><p>${T`คืนพื้นที่ให้เครื่อง — ทุกอย่างคุณเป็นคนเลือกเอง`}</p></div>
    <div class="tabs" id="cl-tabs">
      <button class="tab" data-t="junk">${T`ไฟล์ขยะ`}</button><button class="tab" data-t="dupes">${T`ไฟล์ซ้ำ`}</button>
      <button class="tab" data-t="old">${T`ไฟล์ใหญ่ที่ไม่ได้ใช้นาน`}</button><button class="tab" data-t="empty">${T`โฟลเดอร์ว่าง`}</button>
    </div></div>
  <div id="cl-body"></div>`;
  el.querySelectorAll('#cl-tabs .tab').forEach((t) => { t.classList.toggle('active', t.dataset.t === tab); t.onclick = () => { tab = t.dataset.t; render(); }; });
  ({ junk: renderJunk, dupes: renderDupes, old: renderOld, empty: renderEmpty })[tab](el.querySelector('#cl-body'));
}

/* ------------------------------------------------------------------ junk */
async function scanJunk() {
  junkBusy = true; render();
  junk = await api.invoke('junk:scan');
  junkSel = new Set(junk.filter((j) => j.size > 0 && j.id !== 'wintemp').map((j) => j.id));
  junkBusy = false; render();
}
function renderJunk(box) {
  if (junkBusy) { box.innerHTML = `<div class="card glass"><h3>${T`กำลังวัดขนาดไฟล์ขยะ…`}</h3><div class="progress indet"><i></i></div></div>`; return; }
  if (!junk) { box.innerHTML = `<div class="card glass appear">${emptyState('sparkle', T`ตรวจหาไฟล์ขยะในเครื่อง`, T`ไฟล์ชั่วคราว แคชเบราว์เซอร์ รายงานข้อผิดพลาด และแคชอื่น ๆ ที่ลบได้อย่างปลอดภัย`)}<div style="text-align:center;margin-top:-26px;padding-bottom:26px"><button class="pill-btn primary" id="jk-scan">${icon('radar')}<span>${T`เริ่มตรวจ`}</span></button></div></div>`; box.querySelector('#jk-scan').onclick = scanJunk; return; }
  const total = junk.reduce((s, j) => s + j.size, 0), max = Math.max(1, ...junk.map((j) => j.size));
  const selSize = junk.filter((j) => junkSel.has(j.id)).reduce((s, j) => s + j.size, 0);
  box.innerHTML = `
  <div class="grid g-3" style="margin-bottom:16px">
    <div class="card glass appear"><h3>${T`ไฟล์ขยะทั้งหมดที่พบ`}</h3><div class="stat-big">${fmt(total)}</div><div class="stat-sub">${T`${fmtNum(junk.reduce((s, j) => s + j.n, 0))} ไฟล์`}</div></div>
    <div class="card glass appear span-2" style="--i:1;display:flex;align-items:center;justify-content:space-between;gap:16px"><div><h3>${T`ที่เลือกไว้`}</h3><div class="stat-big" id="jk-sel">${fmt(selSize)}</div><div class="stat-sub">${T`ไฟล์ที่กำลังถูกใช้งานจะถูกข้ามให้อัตโนมัติ`}</div></div>
      <div style="display:flex;gap:8px"><button class="pill-btn" id="jk-re">${icon('refresh')}<span>${T`ตรวจใหม่`}</span></button><button class="pill-btn warn" id="jk-clean" ${selSize ? '' : 'disabled'}>${icon('sparkle')}<span>${T`ล้างที่เลือก`}</span></button></div></div>
  </div>
  <div class="card glass appear" style="--i:2"><div class="rows">${junk.map((j) => `
    <label class="row junk-row clickable"><i class="bar" style="width:${pct(j.size, max)}%"></i><input type="checkbox" data-id="${j.id}" ${junkSel.has(j.id) ? 'checked' : ''}>
      <span class="name">${esc(j.label)}<span class="sub">${esc(j.hint)} · ${esc(j.paths[0])}${j.paths.length > 1 ? ` (+${j.paths.length - 1})` : ''}</span></span>
      <span class="muted">${T`${fmtNum(j.n)} ไฟล์`}</span><span class="val" style="width:86px;text-align:right">${fmt(j.size)}</span></label>`).join('')}</div></div>`;
  box.querySelectorAll('input[type=checkbox]').forEach((c) => {
    c.onchange = () => {
      c.checked ? junkSel.add(c.dataset.id) : junkSel.delete(c.dataset.id);
      const s = junk.filter((j) => junkSel.has(j.id)).reduce((a, j) => a + j.size, 0);
      box.querySelector('#jk-sel').textContent = fmt(s); box.querySelector('#jk-clean').disabled = !s;
    };
  });
  box.querySelector('#jk-re').onclick = scanJunk;
  box.querySelector('#jk-clean').onclick = async () => {
    const ids = [...junkSel];
    const size = junk.filter((j) => junkSel.has(j.id)).reduce((a, j) => a + j.size, 0);
    const ok = await confirmBox(T`ล้างไฟล์ขยะที่เลือก?`, T`จะลบถาวรประมาณ ${fmt(size)} จาก ${ids.length} หมวด\nไฟล์เหล่านี้เป็นไฟล์ชั่วคราว/แคชที่โปรแกรมสร้างใหม่เองได้ — แต่จะไม่เข้าถังรีไซเคิลและย้อนกลับไม่ได้`, T`ลบถาวร`, true);
    if (!ok) return;
    junkBusy = true; render();
    const r = await api.invoke('junk:clean', ids);
    toast(T`ล้างแล้ว คืนพื้นที่ ${fmt(r.freed)}${r.failed ? T` · ข้าม ${fmtNum(r.failed)} รายการที่กำลังใช้งาน` : ''}`);
    await scanJunk();
  };
}

/* ------------------------------------------------------------ duplicates */
async function runDupes() {
  if (!dupeRoot) dupeRoot = state.focus || state.root;
  if (!dupeRoot) return;
  dupeBusy = true; dupes = null; dupeProg = null; dupeSel = new Set(); render();
  const res = await api.invoke('dupes:start', { root: pathOf(dupeRoot), minSize: dupeMin * 1024 * 1024 });
  dupeBusy = false;
  dupes = res ? res.groups : null;
  dupeInfo = res || null;
  // nothing is pre-selected: the user decides what goes to the Recycle Bin
  render();
}
function autoSelect() { // keep the newest copy of each group, mark the rest
  dupeSel = new Set();
  for (const g of dupes) {
    const keep = g.files.reduce((a, b) => (b.m > a.m ? b : a));
    for (const f of g.files) if (f !== keep) dupeSel.add(f.path);
  }
}
const dupeSelSize = () => { let s = 0; for (const g of dupes) for (const f of g.files) if (dupeSel.has(f.path)) s += g.size; return s; };

function renderDupes(box) {
  const rootName = dupeRoot ? pathOf(dupeRoot) : state.focus ? pathOf(state.focus) : '—';
  const head = `<div class="card glass appear" style="margin-bottom:16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
    <div style="flex:1;min-width:240px"><h3 style="margin-bottom:4px">${T`ค้นหาไฟล์ซ้ำใน`}</h3><div style="font-weight:650;word-break:break-all">${esc(rootName)}</div></div>
    <label class="field"><span class="muted">${T`ขนาดขั้นต่ำ`}</span><select id="dp-min">${[[0.1, '100 KB'], [1, '1 MB'], [10, '10 MB'], [100, '100 MB']].map(([v, l]) => `<option value="${v}" ${v === dupeMin ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <button class="pill-btn" id="dp-focus" title="${T`ใช้โฟลเดอร์ที่กำลังดูอยู่`}">${icon('focus')}<span>${T`ใช้โฟลเดอร์ที่กำลังดู`}</span></button>
    ${dupeBusy ? `<button class="pill-btn" id="dp-cancel">${icon('stop')}<span>${T`หยุด`}</span></button>` : `<button class="pill-btn primary" id="dp-run">${icon('copy')}<span>${T`ค้นหาไฟล์ซ้ำ`}</span></button>`}
  </div>`;
  let body;
  if (dupeBusy) body = `<div class="card glass"><h3 id="dp-phase">${T`กำลังรวบรวมรายชื่อไฟล์…`}</h3><div class="progress indet" id="dp-bar"><i></i></div><div class="stat-sub" id="dp-cur" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div></div>`;
  else if (dupeInfo && dupeInfo.protectedRoot) body = `<div class="card glass appear">${emptyState('shield', T`โฟลเดอร์นี้เป็นที่เก็บโปรแกรม`, T`ไม่ค้นหาไฟล์ซ้ำในโฟลเดอร์ของโปรแกรม เครื่องมือ หรือแคช เพราะลบแล้วโปรแกรมจะเสีย — เลือกโฟลเดอร์เอกสาร รูป หรือวิดีโอแทน`)}</div>`;
  else if (!dupes) body = `<div class="card glass appear">${emptyState('copy', T`ยังไม่ได้ค้นหา`, T`เปรียบเทียบเนื้อไฟล์จริงด้วยแฮช — ชื่อไม่เหมือนกันก็หาเจอ`)}<p class="muted" style="text-align:center;margin-top:-6px">${T`ข้ามโฟลเดอร์โปรแกรม (AppData, Program Files, node_modules ฯลฯ) และไฟล์โปรแกรม (.exe, .dll ฯลฯ) ให้อัตโนมัติ`}</p></div>`;
  else if (!dupes.length) body = `<div class="card glass appear">${emptyState('check', T`ไม่พบไฟล์ซ้ำ`, T`โฟลเดอร์นี้สะอาดดี`)}</div>`;
  else {
    const waste = dupes.reduce((s, g) => s + g.size * (g.files.length - 1), 0);
    body = `<div class="grid g-3" style="margin-bottom:16px">
      <div class="card glass appear"><h3>${T`พื้นที่ที่เสียไปกับไฟล์ซ้ำ`}</h3><div class="stat-big">${fmt(waste)}</div><div class="stat-sub">${T`${fmtNum(dupes.length)} กลุ่ม`}</div></div>
      <div class="card glass appear span-2" style="--i:1;display:flex;align-items:center;justify-content:space-between;gap:16px"><div><h3>${T`ที่เลือกไว้เพื่อลบ`}</h3><div class="stat-big" id="dp-sel">${fmt(dupeSelSize())}</div><div class="stat-sub">${T`ยังไม่ได้เลือกไฟล์ใด — ติ๊กเอง หรือกด "เลือกอัตโนมัติ" (เก็บไฟล์ใหม่สุดไว้)`}</div><div class="stat-sub">${T`ข้ามโฟลเดอร์โปรแกรม ${fmtNum((dupeInfo && dupeInfo.skippedDirs) || 0)} โฟลเดอร์เพื่อความปลอดภัย`}</div></div>
        <div style="display:flex;gap:8px"><button class="pill-btn" id="dp-auto">${T`เลือกอัตโนมัติ`}</button><button class="pill-btn" id="dp-none">${T`ไม่เลือกเลย`}</button><button class="pill-btn warn" id="dp-del">${icon('trash')}<span>${T`ย้ายไปถังรีไซเคิล`}</span></button></div></div></div>
      ${dupes.slice(0, 120).map((g, gi) => `<div class="group appear" style="--i:${Math.min(gi, 12)}"><div class="group-head"><i class="dot" style="width:12px;height:12px;border-radius:5px;background:${rgb(CATS[catOf(g.files[0].path)].color)}"></i>${esc(g.files[0].path.slice(g.files[0].path.lastIndexOf('\\') + 1))}<span class="muted">${T`${g.files.length} ไฟล์ × ${fmt(g.size)}`}</span><span class="badge hot" style="margin-left:auto">${T`เสีย ${fmt(g.size * (g.files.length - 1))}`}</span></div>
        <div class="rows">${g.files.map((f) => `<label class="row clickable"><input type="checkbox" data-p="${esc(f.path)}" ${dupeSel.has(f.path) ? 'checked' : ''}><span class="name" style="font-weight:500;font-size:12.5px">${esc(f.path)}</span><span class="muted">${fmtDate(f.m)}</span><span class="acts"><button class="icon-btn" data-reveal="${esc(f.path)}" title="${T`แสดงใน Explorer`}">${icon('reveal')}</button></span></label>`).join('')}</div></div>`).join('')}`;
  }
  box.innerHTML = head + body;
  box.querySelector('#dp-min').onchange = (e) => { dupeMin = +e.target.value; };
  box.querySelector('#dp-focus').onclick = () => { dupeRoot = state.focus; dupes = null; render(); };
  const run = box.querySelector('#dp-run'); if (run) run.onclick = runDupes;
  const cancel = box.querySelector('#dp-cancel'); if (cancel) cancel.onclick = () => api.invoke('dupes:cancel');
  if (!dupes || !dupes.length) return;
  const upd = () => { box.querySelector('#dp-sel').textContent = fmt(dupeSelSize()); };
  box.querySelectorAll('input[data-p]').forEach((c) => { c.onchange = () => { c.checked ? dupeSel.add(c.dataset.p) : dupeSel.delete(c.dataset.p); upd(); }; });
  box.querySelectorAll('[data-reveal]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); api.invoke('fs:reveal', b.dataset.reveal); }; });
  box.querySelector('#dp-auto').onclick = () => { autoSelect(); render(); };
  box.querySelector('#dp-none').onclick = () => { dupeSel = new Set(); render(); };
  box.querySelector('#dp-del').onclick = async () => {
    const paths = [...dupeSel];
    if (!paths.length) { toast(T`ยังไม่ได้เลือกไฟล์`, { kind: 'err' }); return; }
    for (const g of dupes) if (g.files.every((f) => dupeSel.has(f.path))) { toast(T`มีกลุ่มที่เลือกครบทุกไฟล์ — ต้องเหลือไว้อย่างน้อย 1 ไฟล์ต่อกลุ่ม`, { kind: 'err' }); return; }
    const ok = await confirmBox(T`ย้าย ${fmtNum(paths.length)} ไฟล์ซ้ำไปถังรีไซเคิล?`, T`คืนพื้นที่ได้ ${fmt(dupeSelSize())}\nกู้คืนได้จากถังรีไซเคิลของ Windows`, T`ย้ายไปถังรีไซเคิล`, true);
    if (!ok) return;
    let done = 0, freed = 0, fail = 0;
    const batch = {};
    for (const g of dupes) {
      for (const f of [...g.files]) {
        if (!dupeSel.has(f.path)) continue;
        const r = await trashPath(f.path, g.size, batch);
        if (r.ok) { done++; freed += g.size; g.files.splice(g.files.indexOf(f), 1); dupeSel.delete(f.path); } else fail++;
      }
    }
    dupes = dupes.filter((g) => g.files.length > 1);
    toast(T`ย้าย ${fmtNum(done)} ไฟล์ไปถังรีไซเคิลแล้ว (${fmt(freed)})${fail ? T` · ไม่สำเร็จ ${fail}` : ''}`, { label: T`เปิดถังรีไซเคิล`, action: () => api.invoke('fs:recycleBin') });
    bus.emit('stale');
    render();
  };
}

/* ------------------------------------------------------- big & old files */
function renderOld(box) {
  const m = state.meta;
  if (!m) { box.innerHTML = `<div class="card glass">${emptyState('radar', T`ยังไม่ได้สแกน`, '')}</div>`; return; }
  const now = Date.now() / 1000;
  const list = m.top.filter((t) => now - t[2] > YEAR).slice(0, 80);
  if (!list.length) { box.innerHTML = `<div class="card glass appear">${emptyState('check', T`ไม่พบไฟล์ใหญ่ที่ถูกทิ้งไว้นาน`, T`ไฟล์ใหญ่ทั้งหมดถูกแก้ไขภายใน 1 ปีที่ผ่านมา`)}</div>`; return; }
  const total = list.reduce((s, t) => s + t[1], 0);
  box.innerHTML = `<div class="card glass appear" style="margin-bottom:16px"><h3>${T`ไฟล์ใหญ่ที่ไม่ได้แก้ไขเกิน 1 ปี`}</h3><div class="stat-big">${fmt(total)}</div><div class="stat-sub">${T`${fmtNum(list.length)} ไฟล์ — ลองย้ายไปไดรฟ์สำรองหรือลบถ้าไม่ใช้แล้ว (คลิกแถวเพื่อดูตำแหน่งในต้นไม้)`}</div></div>
  <div class="card glass appear" style="--i:1"><div class="rows">${list.map(([p, s, mt]) => { const name = p.slice(p.lastIndexOf('\\') + 1); return `<div class="row clickable" data-path="${esc(p)}"><i class="bar" style="width:${pct(s, list[0][1])}%"></i><i class="dot" style="background:${rgb(CATS[catOf(name)].color)}"></i><span class="name">${esc(name)}<span class="sub">${esc(p)}</span></span><span class="badge cool">${ago(mt)}</span><span class="val" style="width:80px;text-align:right">${fmt(s)}</span><span class="acts"><button class="icon-btn" data-reveal title="${T`แสดงใน Explorer`}">${icon('reveal')}</button><button class="icon-btn" data-trash title="${T`ย้ายไปถังรีไซเคิล`}">${icon('trash')}</button></span></div>`; }).join('')}</div></div>`;
  box.querySelectorAll('[data-path]').forEach((r) => {
    const p = r.dataset.path;
    r.onclick = async (e) => {
      if (e.target.closest('[data-reveal]')) { api.invoke('fs:reveal', p); return; }
      if (e.target.closest('[data-trash]')) {
        const node = findNode(p);
        let ok = false;
        if (node && node.file) ok = await trashNode(node);
        else { const res = await trashPath(p, (m.top.find((t) => t[0] === p) || [])[1]); ok = res.ok; if (!res.skipped) toast(ok ? (res.permanent ? T`ลบถาวรแล้ว` : T`ย้ายไปถังรีไซเคิลแล้ว`) : res.error, { kind: ok ? '' : 'err' }); if (ok) bus.emit('stale'); }
        if (ok) { m.top = m.top.filter((t) => t[0] !== p); render(); }
        return;
      }
      locate(p);
    };
  });
}

/* ---------------------------------------------------------- empty folders */
function renderEmpty(box) {
  if (!state.root) { box.innerHTML = `<div class="card glass">${emptyState('radar', T`ยังไม่ได้สแกน`, '')}</div>`; return; }
  const found = [];
  const stack = [state.focus || state.root];
  while (stack.length && found.length < 400) {
    const d = stack.pop();
    for (const c of d.d) { if (c.c === 0 && c.s === 0 && c.d.every((x) => x.c === 0)) found.push(c); else stack.push(c); }
  }
  if (!found.length) { box.innerHTML = `<div class="card glass appear">${emptyState('check', T`ไม่พบโฟลเดอร์ว่าง`, T`ใน “${esc(displayName(state.focus || state.root))}”`)}</div>`; return; }
  box.innerHTML = `<div class="card glass appear" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:16px"><div><h3>${T`โฟลเดอร์ที่ไม่มีไฟล์อยู่ข้างในเลย`}</h3><div class="stat-big">${fmtNum(found.length)}${found.length >= 400 ? '+' : ''}</div><div class="stat-sub">${T`ใน “${esc(displayName(state.focus || state.root))}” — โฟลเดอร์ว่างไม่กินพื้นที่ แต่ทำให้รก บางโปรแกรมอาจตั้งใจสร้างไว้`}</div></div></div>
  <div class="card glass appear" style="--i:1"><div class="rows">${found.map((n, i) => `<div class="row" data-i="${i}"><i class="dot" style="background:rgb(190,200,235);border-radius:50%"></i><span class="name" style="font-weight:500">${esc(pathOf(n))}</span><span class="acts"><button class="icon-btn" data-reveal title="${T`แสดงใน Explorer`}">${icon('reveal')}</button><button class="icon-btn" data-trash title="${T`ย้ายไปถังรีไซเคิล`}">${icon('trash')}</button></span></div>`).join('')}</div></div>`;
  box.querySelectorAll('[data-i]').forEach((r) => {
    const n = found[+r.dataset.i];
    r.onclick = async (e) => {
      if (e.target.closest('[data-reveal]')) api.invoke('fs:reveal', pathOf(n));
      else if (e.target.closest('[data-trash]')) { if (await trashNode(n)) r.remove(); }
    };
  });
}

export function initCleaner() {
  el = document.getElementById('cleaner');
  api.on('dupes:progress', (m) => {
    dupeProg = m;
    if (!active || tab !== 'dupes') return;
    const ph = el.querySelector('#dp-phase'), bar = el.querySelector('#dp-bar'), cur = el.querySelector('#dp-cur');
    if (!ph) return;
    if (m.phase === 'walk') ph.textContent = T`กำลังรวบรวมรายชื่อไฟล์… ${fmtNum(m.done)} ไฟล์`;
    else { ph.textContent = T`กำลังเปรียบเทียบเนื้อไฟล์… ${fmt(m.done)} / ${fmt(m.total)}`; bar.classList.remove('indet'); bar.firstElementChild.style.width = pct(m.done, m.total) + '%'; }
    cur.textContent = m.cur || '';
  });
  bus.on('dupes:request', (node) => { dupeRoot = node; dupes = null; tab = 'dupes'; bus.emit('view', 'cleaner'); runDupes(); });
  bus.on('scanned', () => { dupes = null; dupeRoot = null; });
  return {
    show() { active = true; render(); },
    hide() { active = false; },
  };
}
