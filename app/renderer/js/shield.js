// Shield — on-demand virus scan of any folder via Windows Defender (report only).
import { T, tr } from './i18n.js';
import { state, bus, api, esc, pathOf, toast, fmtNum, confirmBox, trashPath } from './core.js';
import { icon } from './icons.js';

// Defender reports files inside archives as "archive.zip->inner/path"; only the outer file exists on disk.
const fileOf = (p) => p.split(/->|→|=>/)[0].trim();
const gone = new Set();

async function removeFiles(list) {
  const ok = await confirmBox(
    list.length === 1 ? T`ย้ายไฟล์นี้ไปถังรีไซเคิล?` : T`ย้าย ${fmtNum(list.length)} ไฟล์ไปถังรีไซเคิล?`,
    list.slice(0, 6).join('\n') + (list.length > 6 ? '\n…' : '') + '\n\n' + T`กู้คืนได้จากถังรีไซเคิลของ Windows — ถ้าแน่ใจว่าเป็นไวรัส ให้ล้างถังรีไซเคิลต่อ ไฟล์ที่ Defender แจ้งอาจเป็นผลบวกลวงได้`,
    T`ย้ายไปถังรีไซเคิล`, true);
  if (!ok) return;
  let done = 0, err = '';
  const batch = {};
  for (const f of list) {
    const r = await trashPath(f, 0, batch);
    if (r.ok) { gone.add(f); done++; } else err = r.error || err;
  }
  toast(done ? T`ย้าย ${fmtNum(done)} ไฟล์ไปถังรีไซเคิลแล้ว` + (done < list.length ? ' · ' + err : '') : err || T`ลบไม่สำเร็จ`, { kind: done ? '' : 'err' });
  render();
}

let el, active = false, target = '', busy = false, result = null, log = '', available = true, started = 0, tick = 0;

function render() {
  if (!active) return;
  if (!target && state.focus) target = pathOf(state.focus);
  const cls = busy ? 'on' : result ? (result.clean ? 'clean' : result.threats && result.threats.length ? 'threat' : '') : '';
  let verdict = T`<div class="muted">เลือกโฟลเดอร์แล้วกดเริ่มสแกน</div>`;
  if (busy) verdict = `<div style="font-size:18px;font-weight:680">${T`กำลังสแกน…`}</div><div class="muted" id="av-time">${T`0 วินาที`}</div>`;
  else if (result) {
    if (!result.ok) verdict = `<div style="font-size:17px;font-weight:680;color:#c0355a">${T`สแกนไม่สำเร็จ`}</div><div class="muted">${esc(tr(result.error || ''))}</div>`;
    else if (result.cancelled) verdict = `<div style="font-size:17px;font-weight:680">${T`ยกเลิกแล้ว`}</div>`;
    else if (result.clean) verdict = `<div style="font-size:20px;font-weight:700;color:#1f8f70">${T`ไม่พบภัยคุกคาม`}</div><div class="muted">${T`ใช้เวลา ${(result.ms / 1000).toFixed(1)} วินาที`}</div>`;
    else if (result.threats.length) verdict = `<div style="font-size:20px;font-weight:700;color:#c0355a">${T`พบ ${fmtNum(result.threats.length)} ภัยคุกคาม`}</div><div class="muted">${T`Prism ไม่ลบอะไรเอง — กดปุ่มถังขยะข้างไฟล์เพื่อลบ หรือจัดการต่อใน Windows Security`}</div>`;
    else verdict = `<div style="font-size:17px;font-weight:680">${T`สแกนจบด้วยรหัส ${result.code}`}</div><div class="muted">${T`ดูรายละเอียดในบันทึกด้านขวา`}</div>`;
  }
  const left = result && result.files ? [...new Set(result.files.map(fileOf))].filter((f) => !gone.has(f)) : [];
  const threats = result && result.ok && result.threats && result.threats.length
    ? `<div class="card glass appear" style="margin-top:16px"><h3>${T`${icon('warn')} ภัยคุกคามที่พบ`}</h3><div class="rows">${result.threats.map((t) => `<div class="row"><i class="dot" style="background:#ff7d9c"></i><span class="name">${esc(t.name)}</span></div>`).join('')}${result.files.map((p) => { const f = fileOf(p), g = gone.has(f); return `<div class="row ${g ? '' : 'clickable'}" ${g ? '' : `data-file="${esc(f)}"`} style="${g ? 'opacity:.5' : ''}"><span class="name" style="font-weight:500;font-size:12.5px">${esc(p)}</span><span class="acts">${g ? `<span class="muted">${T`ลบแล้ว`}</span>` : `<button class="icon-btn" title="${T`แสดงใน Explorer`}">${icon('reveal')}</button><button class="icon-btn" data-del="${esc(f)}" title="${T`ย้ายไปถังรีไซเคิล`}">${icon('trash')}</button>`}</span></div>`; }).join('')}</div>
       <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">${left.length ? `<button class="pill-btn warn" id="av-delall">${icon('trash')}<span>${T`ลบไฟล์ที่พบทั้งหมด`}</span></button>` : ''}<button class="pill-btn" id="av-sec">${icon('shield')}<span>${T`เปิด Windows Security เพื่อจัดการ`}</span></button></div></div>` : '';
  el.innerHTML = `
  <div class="page-head appear"><div><h2>${T`สแกนไวรัส`}</h2><p>${T`สแกนเฉพาะโฟลเดอร์ที่ต้องการด้วย Microsoft Defender ในเครื่อง — สแกนไม่ลบอะไรเอง คุณเลือกลบไฟล์ที่พบได้เอง`}</p></div></div>
  ${available ? '' : `<div class="card glass" style="margin-bottom:16px">${T`${icon('warn')} ไม่พบ Microsoft Defender ในเครื่องนี้ — ฟีเจอร์นี้ใช้งานไม่ได้`}</div>`}
  <div class="shield-stage">
    <div class="card glass appear" style="text-align:center">
      <div class="radar ${cls}"><div class="sweep"></div><div class="core">${icon(result && !busy && result.ok && !result.clean && result.threats.length ? 'warn' : 'shield')}</div></div>
      ${verdict}
    </div>
    <div class="card glass appear" style="--i:1">
      <h3>${T`เป้าหมาย`}</h3>
      <div class="target-box">${target ? esc(target) : T`<span class="muted">ยังไม่ได้เลือก</span>`}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        <button class="pill-btn" id="av-pick" ${busy ? 'disabled' : ''}>${icon('folder')}<span>${T`เลือกโฟลเดอร์…`}</span></button>
        <button class="pill-btn" id="av-focus" ${busy || !state.focus ? 'disabled' : ''}>${icon('focus')}<span>${T`ใช้โฟลเดอร์ที่กำลังดู`}</span></button>
        ${busy ? `<button class="pill-btn warn" id="av-stop">${icon('stop')}<span>${T`หยุดสแกน`}</span></button>` : `<button class="pill-btn primary" id="av-go" ${target && available ? '' : 'disabled'}>${icon('play')}<span>${T`เริ่มสแกน`}</span></button>`}
      </div>
      <h3>${T`บันทึกจาก Defender`}</h3>
      <div class="av-log" id="av-log">${esc(log) || '<span class="muted">—</span>'}</div>
    </div>
  </div>${threats}`;
  const $ = (s) => el.querySelector(s);
  $('#av-pick').onclick = async () => { const p = await api.invoke('dialog:pickFolder'); if (p) { target = p; result = null; log = ''; render(); } };
  $('#av-focus').onclick = () => { target = pathOf(state.focus); result = null; log = ''; render(); };
  if ($('#av-go')) $('#av-go').onclick = start;
  if ($('#av-stop')) $('#av-stop').onclick = () => api.invoke('av:cancel');
  if ($('#av-sec')) $('#av-sec').onclick = () => api.invoke('av:openSecurity');
  el.querySelectorAll('[data-file]').forEach((r) => { r.onclick = () => api.invoke('fs:reveal', r.dataset.file); });
  el.querySelectorAll('[data-del]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); removeFiles([b.dataset.del]); }; });
  if ($('#av-delall')) $('#av-delall').onclick = () => removeFiles(left);
  const lg = $('#av-log'); lg.scrollTop = lg.scrollHeight;
}

async function start() {
  if (busy || !target) return;
  busy = true; result = null; log = ''; gone.clear(); started = Date.now();
  render();
  clearInterval(tick);
  tick = setInterval(() => { const t = el.querySelector('#av-time'); if (t) t.textContent = T`${Math.floor((Date.now() - started) / 1000)} วินาที`; }, 500);
  const r = await api.invoke('av:scan', target);
  clearInterval(tick);
  busy = false; result = r;
  if (r.ok && !r.cancelled) toast(r.clean ? T`สแกนเสร็จ — ไม่พบภัยคุกคาม` : r.threats.length ? T`พบ ${r.threats.length} ภัยคุกคาม` : T`สแกนเสร็จแล้ว`, { kind: r.clean ? '' : 'err' });
  render();
}

export function initShield() {
  el = document.getElementById('shield');
  api.invoke('av:available').then((v) => { available = v; if (active) render(); });
  api.on('av:log', (s) => {
    log = (log + s).slice(-20000);
    const lg = el.querySelector('#av-log');
    if (lg && active) { lg.textContent = log; lg.scrollTop = lg.scrollHeight; }
  });
  bus.on('av:request', (p) => { if (busy) { toast(T`กำลังสแกนอยู่ — รอให้เสร็จก่อน`, { kind: 'err' }); return; } target = p; result = null; log = ''; bus.emit('view', 'shield'); start(); });
  return {
    show() { active = true; render(); },
    hide() { active = false; },
  };
}
