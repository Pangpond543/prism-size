// Installed programs — what is big, what is old, what can go.
import { T } from './i18n.js';
import { api, bus, fmt, fmtNum, fmtDate, ago, esc, pct, toast, confirmBox } from './core.js';
import { icon } from './icons.js';

let el, active = false, apps = null, loading = false, q = '', sort = 'size';
const icons = new Map();
const YEAR = 365 * 86400;

function advice(a) {
  const now = Date.now() / 1000, tags = [];
  if (a.size >= 5 * 1024 ** 3) tags.push(T`<span class="badge hot">ใหญ่มาก</span>`);
  else if (a.size >= 1024 ** 3) tags.push(T`<span class="badge hot">ใหญ่</span>`);
  if (a.date && now - a.date > 2 * YEAR) tags.push(T`<span class="badge cool">ติดตั้งนานกว่า 2 ปี</span>`);
  if (a.size >= 1024 ** 3 && a.date && now - a.date > YEAR) tags.push(T`<span class="badge">น่าทบทวน</span>`);
  return tags.join(' ');
}

function render() {
  if (!active) return;
  if (!apps) {
    el.innerHTML = `<div class="page-head"><div><h2>${T`โปรแกรมที่ติดตั้ง`}</h2><p>${T`กำลังอ่านรายการโปรแกรมจาก Windows…`}</p></div></div><div class="card glass"><div class="progress indet"><i></i></div></div>`;
    return;
  }
  const total = apps.reduce((s, a) => s + a.size, 0);
  const big = apps.filter((a) => a.size >= 1024 ** 3);
  el.innerHTML = `
  <div class="page-head appear"><div><h2>${T`โปรแกรมที่ติดตั้ง`}</h2><p>${T`ดูว่าโปรแกรมไหนใหญ่ ติดตั้งมานาน และอาจไม่จำเป็นแล้ว`}</p></div>
    <div class="head-tools">
      <label class="field">${icon('search')}<input id="app-q" placeholder="${T`ค้นหาโปรแกรม…`}" value="${esc(q)}" spellcheck="false"></label>
      <div class="tabs" id="app-sort"><button class="tab" data-s="size">${T`ขนาด`}</button><button class="tab" data-s="date">${T`ติดตั้งนานสุด`}</button><button class="tab" data-s="name">${T`ชื่อ`}</button></div>
      <button class="pill-btn" id="app-settings">${icon('apps')}<span>${T`เปิดการตั้งค่า Windows`}</span></button>
    </div></div>
  <div class="grid g-3" style="margin-bottom:16px">
    <div class="card glass appear" style="--i:1"><h3>${T`โปรแกรมทั้งหมด`}</h3><div class="stat-big">${fmtNum(apps.length)}</div><div class="stat-sub">${T`รายการที่ลงทะเบียนกับ Windows`}</div></div>
    <div class="card glass appear" style="--i:2"><h3>${T`พื้นที่ที่ใช้รวม`}</h3><div class="stat-big" id="app-total">${fmt(total)}</div><div class="stat-sub">${T`บางโปรแกรมไม่ได้แจ้งขนาด — กำลังวัดจากโฟลเดอร์จริง`}</div></div>
    <div class="card glass appear" style="--i:3"><h3>${T`โปรแกรมที่ใหญ่กว่า 1 GB`}</h3><div class="stat-big">${fmtNum(big.length)}</div><div class="stat-sub">${T`รวม ${fmt(big.reduce((s, a) => s + a.size, 0))}`}</div></div>
  </div>
  <div class="card glass appear" style="--i:4"><div class="rows" id="app-rows"></div></div>`;
  el.querySelector('#app-q').oninput = (e) => { q = e.target.value; rows(); };
  el.querySelectorAll('#app-sort .tab').forEach((t) => { t.classList.toggle('active', t.dataset.s === sort); t.onclick = () => { sort = t.dataset.s; el.querySelectorAll('#app-sort .tab').forEach((x) => x.classList.toggle('active', x === t)); rows(); }; });
  el.querySelector('#app-settings').onclick = () => api.invoke('apps:settings');
  rows();
}

function rows() {
  const box = el.querySelector('#app-rows');
  if (!box) return;
  const term = q.trim().toLowerCase();
  let list = apps.filter((a) => !term || a.name.toLowerCase().includes(term) || a.publisher.toLowerCase().includes(term));
  if (sort === 'size') list.sort((a, b) => b.size - a.size);
  else if (sort === 'date') list.sort((a, b) => (a.date || 9e12) - (b.date || 9e12));
  else list.sort((a, b) => a.name.localeCompare(b.name));
  const max = Math.max(1, ...apps.map((a) => a.size));
  box.innerHTML = list.map((a) => `
    <div class="row app-row" data-id="${a.id}">
      ${icons.get(a.id) ? `<img class="ico" src="${icons.get(a.id)}">` : `<span class="ico-ph" data-ph="${a.id}">${esc(a.name[0].toUpperCase())}</span>`}
      <span class="name">${esc(a.name)} ${advice(a)}<span class="sub">${esc(a.publisher || T`ไม่ระบุผู้พัฒนา`)}${a.version ? ' · v' + esc(a.version) : ''}${a.date ? T` · ติดตั้ง ` + fmtDate(a.date) + ' (' + ago(a.date) + ')' : ''}</span></span>
      <span class="acts">
        ${a.location ? `<button class="icon-btn" data-act="reveal" title="${T`เปิดโฟลเดอร์ติดตั้ง`}">${icon('reveal')}</button><button class="icon-btn" data-act="av" title="${T`สแกนไวรัสโฟลเดอร์นี้`}">${icon('shield')}</button>` : ''}
        ${a.canUninstall ? `<button class="icon-btn" data-act="un" title="${T`ถอนการติดตั้ง`}">${icon('uninstall')}</button>` : ''}
      </span>
      <span class="app-size-bar"><i style="width:${pct(a.size, max)}%"></i></span>
      <span class="val app-val">${a.size ? fmt(a.size) : '<span class="muted">—</span>'}</span>
    </div>`).join('') || T`<div class="empty">ไม่พบโปรแกรมที่ตรงกับคำค้น</div>`;
  box.querySelectorAll('.row').forEach((r) => {
    const a = apps.find((x) => x.id === +r.dataset.id);
    r.onclick = async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'reveal') api.invoke('fs:open', a.location);
      else if (b.dataset.act === 'av') bus.emit('av:request', a.location);
      else if (b.dataset.act === 'un') {
        const ok = await confirmBox(T`ถอนการติดตั้ง “${a.name}”?`, T`Prism จะเปิดตัวถอนการติดตั้งของโปรแกรมนี้ให้ (${a.size ? fmt(a.size) : T`ไม่ทราบขนาด`})\nขั้นตอนนี้ย้อนกลับไม่ได้ — ทำตามหน้าต่างของโปรแกรมนั้นต่อ`, T`เปิดตัวถอนการติดตั้ง`, true);
        if (!ok) return;
        const res = await api.invoke('apps:uninstall', a.id);
        toast(res.ok ? T`เปิดตัวถอนการติดตั้งของ “${a.name}” แล้ว` : res.error, { kind: res.ok ? '' : 'err' });
      }
    };
  });
  // lazy icons — only for rows on screen
  box.querySelectorAll('[data-ph]').forEach((ph) => io.observe(ph));
}

const io = new IntersectionObserver((ents) => {
  for (const en of ents) {
    if (!en.isIntersecting) continue;
    io.unobserve(en.target);
    const id = +en.target.dataset.ph, a = apps && apps.find((x) => x.id === id);
    if (!a || !a.icon) continue;
    api.invoke('app:icon', a.icon).then((url) => {
      if (!url) return;
      icons.set(id, url);
      if (en.target.isConnected) { const img = document.createElement('img'); img.className = 'ico'; img.src = url; en.target.replaceWith(img); }
    });
  }
});

async function load() {
  if (loading) return;
  loading = true;
  apps = await api.invoke('apps:list');
  loading = false;
  render();
  const need = apps.filter((a) => !a.size && a.location).map((a) => a.id);
  if (need.length) api.invoke('apps:sizes', need);
}

export function initApps() {
  el = document.getElementById('apps');
  let timer = 0;
  api.on('apps:size', ({ id, size }) => {
    const a = apps && apps.find((x) => x.id === id);
    if (!a || !size) return;
    a.size = size;
    clearTimeout(timer);
    timer = setTimeout(() => { if (active) { rows(); const t = el.querySelector('#app-total'); if (t) t.textContent = fmt(apps.reduce((s, x) => s + x.size, 0)); } }, 400);
  });
  return {
    show() { active = true; render(); if (!apps) load(); },
    hide() { active = false; },
  };
}
