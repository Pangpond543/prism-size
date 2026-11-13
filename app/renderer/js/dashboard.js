// Dashboard — drives, file-type donut, age histogram, biggest files and folders.
import { T } from './i18n.js';
import {
  state, bus, api, CATS, catOfExt, catOf, rgb, fmt, fmtNum, fmtPct, pct, fmtDate, ago, esc, displayName,
  childrenOf, isDir, colorOf, select, setFocus, setView, findNode, floaty, showNodeMenu,
} from './core.js';
import { icon } from './icons.js';

let el, active = false, drives = [];
const AGE_LABELS = [T`< 1 เดือน`, T`1–6 เดือน`, T`6–12 เดือน`, T`1–2 ปี`, T`2–5 ปี`, T`> 5 ปี`];

export function ringSvg(p, id = 'ring-grad') {
  const c = 2 * Math.PI * 34, v = Math.max(0, Math.min(1, p)) * c;
  return `<svg viewBox="0 0 80 80"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ea2ff"/><stop offset=".55" stop-color="#c79bff"/><stop offset="1" stop-color="#ff9ec7"/></linearGradient></defs>
  <circle class="track" cx="40" cy="40" r="34"/><circle class="val" cx="40" cy="40" r="34" stroke="url(#${id})" stroke-dasharray="0 ${c}" data-dash="${v} ${c}"/></svg>`;
}
export function animateRings(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll('[data-dash]').forEach((c) => c.setAttribute('stroke-dasharray', c.dataset.dash));
    root.querySelectorAll('[data-w]').forEach((c) => { c.style.width = c.dataset.w; });
  }));
}

function render() {
  if (!active) return;
  const m = state.meta, root = state.root, focus = state.focus;
  if (!m || !root) { el.innerHTML = ''; return; }

  // categories from extension stats (whole scan)
  const cats = {};
  for (const k of Object.keys(CATS)) cats[k] = { n: 0, s: 0 };
  for (const [e, n, s] of m.ext) { const c = cats[catOfExt(e)]; c.n += n; c.s += s; }
  const catArr = Object.entries(cats).filter(([, v]) => v.s > 0).sort((a, b) => b[1].s - a[1].s);
  const total = m.bytes || 1;
  let acc = 0;
  const donut = catArr.map(([k, v]) => {
    const p = (v.s / total) * 100;
    const seg = `<circle cx="21" cy="21" r="15.915" stroke="${rgb(CATS[k].color)}" stroke-dasharray="0 100" data-dash="${Math.max(0, p - 0.35)} ${100 - Math.max(0, p - 0.35)}" stroke-dashoffset="${-acc}" data-cat="${k}"><title>${CATS[k].label} — ${fmt(v.s)}</title></circle>`;
    acc += p;
    return seg;
  }).join('');
  const legend = catArr.map(([k, v]) => `<div class="row"><i class="bar" style="width:${pct(v.s, catArr[0][1].s)}%"></i><i class="dot" style="background:${rgb(CATS[k].color)}"></i><span class="name">${CATS[k].label}<span class="sub">${T`${fmtNum(v.n)} ไฟล์`}</span></span><span class="val">${fmt(v.s)}</span><span class="muted" style="width:44px;text-align:right">${fmtPct(v.s, total)}</span></div>`).join('');

  const topExt = m.ext.slice(0, 9).map(([e, n, s]) => `<div class="row"><i class="bar" style="width:${pct(s, m.ext[0][2])}%"></i><i class="dot" style="background:${rgb(CATS[catOfExt(e)].color)}"></i><span class="name">${e ? '.' + esc(e) : T`(ไม่มีนามสกุล)`}<span class="sub">${T`${fmtNum(n)} ไฟล์`}</span></span><span class="val">${fmt(s)}</span></div>`).join('');

  const ageMax = Math.max(...m.age, 1);
  const ages = m.age.map((s, i) => `<div class="age-col"><b>${fmt(s)}</b><div class="age-bar" style="height:${Math.max(2, (s / ageMax) * 100)}%;--i:${i}" title="${T`${fmtNum(m.agen[i])} ไฟล์`}"></div><small>${AGE_LABELS[i]}</small></div>`).join('');
  const oldBytes = m.age[3] + m.age[4] + m.age[5];

  const topFiles = m.top.slice(0, 14).map(([p, s, mt], i) => {
    const name = p.slice(p.lastIndexOf('\\') + 1);
    return `<div class="row clickable" data-path="${esc(p)}"><i class="bar" style="width:${pct(s, m.top[0][1])}%"></i><i class="dot" style="background:${rgb(CATS[catOf(name)].color)}"></i><span class="name">${esc(name)}<span class="sub">${esc(p)}</span></span><span class="muted">${ago(mt)}</span><span class="val">${fmt(s)}</span><span class="acts"><button class="icon-btn" data-reveal="${esc(p)}" title="${T`แสดงใน Explorer`}">${icon('reveal')}</button></span></div>`;
  }).join('');

  const kids = childrenOf(focus).slice(0, 10);
  const topKids = kids.map((n, i) => `<div class="row clickable" data-kid="${i}"><i class="bar" style="width:${pct(n.s, kids[0].s)}%"></i><i class="dot" style="background:${rgb(colorOf(n))};border-radius:${n.file ? 4 : 50}%"></i><span class="name">${esc(n.n)}<span class="sub">${isDir(n) ? fmtNum(n.c) + T` ไฟล์` : CATS[catOf(n.n)].label}</span></span><span class="muted">${fmtPct(n.s, focus.s)}</span><span class="val">${fmt(n.s)}</span></div>`).join('');

  const drv = drives.map((d, i) => `<div class="drive-mini"><div class="ring">${ringSvg(d.used / d.total, 'rg' + i)}<b>${Math.round((d.used / d.total) * 100)}%</b></div><div><div style="font-weight:680">${T`ไดรฟ์ ${d.root.slice(0, 2)}`}</div><div class="muted" style="font-size:12px">${T`ใช้ ${fmt(d.used)} / ${fmt(d.total)}`}</div><div class="muted" style="font-size:12px">${T`ว่าง ${fmt(d.free)}`}</div></div></div>`).join('');

  el.innerHTML = `
  <div class="page-head appear"><div><h2>${T`แดชบอร์ด`}</h2><p>${T`ภาพรวมของ “${esc(root.n)}” — สแกนด้วย ${m.engine === 'rust' ? 'Rust' : 'Node'} ใน ${(m.ms / 1000).toFixed(1)} วินาที`}</p></div></div>
  <div class="grid g-4" style="margin-bottom:16px">
    <div class="card glass appear el" style="--i:1"><h3>${T`ขนาดรวมที่สแกน`}</h3><div class="stat-big">${fmt(m.bytes)}</div><div class="stat-sub">${esc(root.n)}</div></div>
    <div class="card glass appear el" style="--i:2"><h3>${T`จำนวนไฟล์`}</h3><div class="stat-big">${fmtNum(m.files)}</div><div class="stat-sub">${T`ใน ${fmtNum(m.dirs)} โฟลเดอร์`}</div></div>
    <div class="card glass appear el" style="--i:3"><h3>${T`ไฟล์ที่ไม่ได้แตะเกิน 1 ปี`}</h3><div class="stat-big">${fmt(oldBytes)}</div><div class="stat-sub">${T`${fmtPct(oldBytes, total)} ของทั้งหมด — อาจย้ายไปเก็บที่อื่นได้`}</div></div>
    <div class="card glass appear el" style="--i:4"><h3>${T`ไฟล์ใหญ่ที่สุด`}</h3><div class="stat-big">${m.top[0] ? fmt(m.top[0][1]) : '—'}</div><div class="stat-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.top[0] ? esc(m.top[0][0].slice(m.top[0][0].lastIndexOf('\\') + 1)) : ''}</div></div>
  </div>
  <div class="grid g-3" style="margin-bottom:16px">
    <div class="card glass appear span-2 el" style="--i:5"><h3>${T`พื้นที่แยกตามประเภทไฟล์`} <small>${T`ทั้งหมดที่สแกน`}</small></h3>
      <div class="donut-wrap"><div class="donut"><svg viewBox="0 0 42 42">${donut}</svg><div class="center"><div><b id="dn-val">${fmt(m.bytes)}</b><span id="dn-lab">${T`ทั้งหมด`}</span></div></div></div><div class="legend rows">${legend}</div></div></div>
    <div class="card glass appear el" style="--i:6"><h3>${T`ไดรฟ์ในเครื่อง`}</h3><div style="display:flex;flex-direction:column;gap:14px">${drv || '<span class="muted">—</span>'}</div>${m.errors ? `<div class="stat-sub" style="margin-top:14px">${T`ข้าม ${fmtNum(m.errors)} รายการที่ไม่มีสิทธิ์อ่าน`}</div>` : ''}</div>
  </div>
  <div class="grid g-3" style="margin-bottom:16px">
    <div class="card glass appear span-2 el" style="--i:7"><h3>${T`อายุของไฟล์`} <small>${T`นับจากวันที่แก้ไขล่าสุด`}</small></h3><div class="age-bars">${ages}</div></div>
    <div class="card glass appear el" style="--i:8"><h3>${T`นามสกุลที่กินพื้นที่มากสุด`}</h3><div class="rows">${topExt}</div></div>
  </div>
  <div class="grid g-2">
    <div class="card glass appear el" style="--i:9"><h3>${T`ไฟล์ใหญ่ที่สุด`} <small>${T`คลิกเพื่อดูตำแหน่งในต้นไม้`}</small></h3><div class="rows">${topFiles || T`<div class="empty">ไม่มีข้อมูล</div>`}</div></div>
    <div class="card glass appear el" style="--i:10"><h3>${T`ใหญ่ที่สุดใน “${esc(displayName(focus))}”`} <small>${fmt(focus.s)}</small></h3><div class="rows">${topKids || T`<div class="empty">ว่างเปล่า</div>`}</div></div>
  </div>`;
  animateRings(el);
  el.querySelectorAll('.card.el').forEach((c) => { const h = c.querySelector('h3'); if (h) floaty(c, h, { elastic: true }); });
  el.querySelectorAll('.donut circle').forEach((c) => {
    c.onmouseenter = () => { const k = c.dataset.cat; el.querySelector('#dn-val').textContent = fmt(cats[k].s); el.querySelector('#dn-lab').textContent = CATS[k].label; };
    c.onmouseleave = () => { el.querySelector('#dn-val').textContent = fmt(m.bytes); el.querySelector('#dn-lab').textContent = T`ทั้งหมด`; };
  });
  el.querySelectorAll('[data-path]').forEach((r) => {
    r.onclick = (e) => {
      if (e.target.closest('[data-reveal]')) { api.invoke('fs:reveal', e.target.closest('[data-reveal]').dataset.reveal); return; }
      locate(r.dataset.path);
    };
  });
  el.querySelectorAll('[data-kid]').forEach((r) => {
    const n = kids[+r.dataset.kid];
    r.onclick = () => select(n);
    r.ondblclick = () => { if (isDir(n)) setFocus(n); };
    r.oncontextmenu = (e) => { e.preventDefault(); showNodeMenu(n, e.clientX, e.clientY); };
  });
}

// jump to the tree view and expand down to this path
export function locate(path) {
  const node = findNode(path);
  if (!node) return;
  if (state.focus !== state.root) setFocus(state.root);
  setView('tree');
  setTimeout(() => bus.emit('reveal', node), 80);
}

export function initDashboard() {
  el = document.getElementById('dashboard');
  bus.on('model', render);
  bus.on('focus', render);
  return {
    async show() { active = true; drives = await api.invoke('drives:list'); render(); },
    hide() { active = false; },
  };
}
