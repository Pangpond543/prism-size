// Sunburst — concentric glass rings, one ring per folder level.
import { T } from './i18n.js';
import {
  state, bus, api, childrenOf, isDir, colorOf, rgba, fmt, fmtPct, fmtNum, displayName, esc, clamp, ease,
  select, setFocus, showNodeMenu, pathOf, tooltip,
} from './core.js';

let canvas, ctx, W = 0, H = 0, dpr = 1, active = false, raf = 0;
let arcs = [], hover = null, dirty = true, animStart = 0, cx = 0, cy = 0, R = 0, r0 = 0, ring = 0, spin = 0;
const LEVELS = 6;

function compute() {
  dirty = false; arcs = [];
  const root = state.focus;
  const insp = document.body.classList.contains('has-insp') ? 344 : 0;
  cx = 92 + (W - 92 - insp) / 2; cy = 70 + (H - 70 - 70) / 2;
  R = Math.max(120, Math.min(W - 92 - insp, H - 150) / 2 - 44);
  r0 = R * 0.24; ring = (R - r0) / LEVELS; let deepest = 0;
  if (!root || !root.s) return;
  const walk = (dir, a0, a1, depth, tint) => {
    let a = a0;
    const span = a1 - a0;
    const kids = childrenOf(dir).filter((c) => c.s > 0);
    let shown = 0, shownN = 0;
    for (const c of kids) {
      const w = (c.s / dir.s) * span;
      if (w < 0.0035) break; // too thin to see — folded into the remainder wedge
      const col = depth === 0 || c.file ? colorOf(c) : tint;
      const arc = { node: c, a0: a, a1: a + w, depth, col };
      arcs.push(arc); shown += c.s; shownN++; if (depth > deepest) deepest = depth;
      if (isDir(c) && depth < LEVELS - 1) walk(c, a, a + w, depth + 1, depth === 0 ? colorOf(c) : tint);
      a += w;
    }
    const rest = dir.s - shown;
    if (rest / dir.s * span > 0.006) {
      if (!dir._agg2) dir._agg2 = { agg: true, n: '…', p: dir };
      dir._agg2.s = rest; dir._agg2.count = kids.length - shownN + (dir.rc || 0);
      arcs.push({ node: dir._agg2, a0: a, a1: a0 + span, depth, col: [205, 210, 230] });
    }
  };
  walk(root, -Math.PI / 2, Math.PI * 1.5, 0, null);
  ring = (R - r0) / Math.max(3, deepest + 1); // shallow trees still fill the disc
  animStart = performance.now();
}

function draw(now) {
  raf = 0;
  if (!active) return;
  if (dirty) compute();
  const t = clamp((now - animStart) / 1100, 0, 1);
  spin += 0.0004;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  // glass disc behind the rings
  let g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R * 1.08);
  g.addColorStop(0, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,.12)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();

  for (const a of arcs) {
    const lt = ease(clamp(t * 1.9 - a.depth * 0.16, 0, 1));
    if (lt <= 0) continue;
    const start = -Math.PI / 2;
    const a0 = start + (a.a0 - start) * lt, a1 = start + (a.a1 - start) * lt;
    const ri = r0 + ring * a.depth + 1.2, ro = r0 + ring * (a.depth + 1) * (0.7 + 0.3 * lt) + (a === hover ? 5 : 0);
    if (a1 - a0 < 0.0008) continue;
    ctx.beginPath(); ctx.arc(cx, cy, ro, a0, a1); ctx.arc(cx, cy, ri, a1, a0, true); ctx.closePath();
    const light = 0.06 * a.depth;
    const alpha = (a === hover ? 0.98 : 0.84 - a.depth * 0.05) * lt;
    g = ctx.createRadialGradient(cx, cy, ri, cx, cy, ro);
    g.addColorStop(0, rgba(a.col.map((v) => Math.round(v + (255 - v) * (0.42 + light))), alpha));
    g.addColorStop(1, rgba(a.col.map((v) => Math.round(v + (255 - v) * light)), alpha));
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = a === hover || state.selected === a.node ? 2.2 : 1;
    ctx.strokeStyle = state.selected === a.node ? 'rgba(124,140,255,.95)' : 'rgba(255,255,255,.92)';
    ctx.stroke();
    // label along the wedge when there is room
    const mid = (a0 + a1) / 2, rm = (ri + ro) / 2, arcLen = (a1 - a0) * rm;
    if (lt > 0.9 && arcLen > 46 && ring > 22 && !a.node.agg) {
      let name = displayName(a.node);
      const max = Math.floor(arcLen / 7.2);
      if (name.length > max) name = name.slice(0, Math.max(2, max - 1)) + '…';
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * rm, cy + Math.sin(mid) * rm);
      let rot = mid + Math.PI / 2;
      if (Math.sin(mid) > 0) rot += Math.PI; // keep text upright on the lower half
      ctx.rotate(rot);
      ctx.font = '600 11px "Segoe UI Variable Display","Segoe UI","Leelawadee UI",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(35,42,71,.88)';
      ctx.fillText(name, 0, 0);
      ctx.restore();
    }
  }
  // sheen sweeping across the disc
  g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  g.addColorStop(0, 'rgba(255,255,255,.34)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,.1)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2); ctx.arc(cx, cy, r0, 0, Math.PI * 2, true); ctx.fill();

  // centre orb
  const up = state.focus && state.focus.p;
  g = ctx.createRadialGradient(cx - r0 * 0.35, cy - r0 * 0.4, r0 * 0.05, cx, cy, r0);
  g.addColorStop(0, 'rgba(255,255,255,.98)'); g.addColorStop(1, hover === 'center' && up ? 'rgba(200,208,255,.9)' : 'rgba(232,236,255,.78)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r0 - 4, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
  const show = hover && hover !== 'center' ? hover.node : state.focus;
  if (show) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(35,42,71,.95)';
    ctx.font = `720 ${clamp(r0 * 0.3, 15, 30)}px "Segoe UI Variable Display","Segoe UI",sans-serif`;
    ctx.fillText(fmt(show.s), cx, cy - 2);
    ctx.font = '600 11.5px "Segoe UI","Leelawadee UI",sans-serif'; ctx.fillStyle = 'rgba(74,83,118,.95)';
    let name = displayName(show); const max = Math.floor(r0 * 1.7 / 6.5);
    if (name.length > max) name = name.slice(0, Math.max(3, max - 1)) + '…';
    ctx.fillText(name, cx, cy - r0 * 0.36);
    ctx.font = '500 10.5px "Segoe UI","Leelawadee UI",sans-serif'; ctx.fillStyle = 'rgba(123,132,166,.95)';
    ctx.fillText(show === state.focus ? (up ? T`คลิกเพื่อย้อนขึ้น` : T`${fmtNum(show.c)} ไฟล์`) : fmtPct(show.s, state.focus.s) + T` ของมุมมองนี้`, cx, cy + r0 * 0.36);
  }
  if (t < 1) raf = requestAnimationFrame(draw);
}
const redraw = () => { if (active && !raf) raf = requestAnimationFrame(draw); };

function hit(x, y) {
  const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
  if (d < r0 - 4) return 'center';
  if (d > R + 8) return null;
  const depth = Math.floor((d - r0) / ring);
  let ang = Math.atan2(dy, dx);
  if (ang < -Math.PI / 2) ang += Math.PI * 2;
  for (const a of arcs) if (a.depth === depth && ang >= a.a0 && ang <= a.a1) return a;
  return null;
}
const local = (e) => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
function resize() {
  const b = canvas.getBoundingClientRect();
  if (!b.width) return;
  W = b.width; H = b.height; dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  dirty = true; redraw();
}

export function initSunburst() {
  canvas = document.getElementById('sunburst-canvas');
  ctx = canvas.getContext('2d');
  canvas.style.cursor = 'default';
  new ResizeObserver(resize).observe(canvas);
  canvas.addEventListener('pointermove', (e) => {
    const h = hit(...local(e));
    if (h !== hover) { hover = h; redraw(); }
    canvas.style.cursor = h ? 'pointer' : 'default';
    if (h && h !== 'center') {
      const n = h.node;
      tooltip(`<b>${esc(displayName(n))}</b><span>${T`${fmt(n.s)} · ${fmtPct(n.s, state.focus.s)} ของมุมมองนี้${isDir(n) ? T` · ${fmtNum(n.c)} ไฟล์` : ''}${n.agg ? T` · รายการเล็ก ๆ รวมกัน` : ''}`}</span>`, e.clientX, e.clientY);
    } else tooltip(null);
  });
  canvas.addEventListener('pointerleave', () => { hover = null; tooltip(null); redraw(); });
  canvas.addEventListener('click', (e) => {
    const h = hit(...local(e));
    if (h === 'center') { if (state.focus && state.focus.p) setFocus(state.focus.p); return; }
    if (!h || h.node.agg) { if (!h) select(null); return; }
    select(h.node);
  });
  canvas.addEventListener('dblclick', (e) => {
    const h = hit(...local(e));
    if (!h || h === 'center' || h.node.agg) return;
    if (isDir(h.node)) setFocus(h.node); else api.invoke('fs:open', pathOf(h.node));
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault(); tooltip(null);
    const h = hit(...local(e));
    if (h && h !== 'center') showNodeMenu(h.node, e.clientX, e.clientY);
  });
  bus.on('focus', () => { dirty = true; redraw(); });
  bus.on('model', () => { dirty = true; redraw(); });
  bus.on('select', () => { if (dirty) return; const keep = animStart; compute(); animStart = keep; redraw(); });
  return {
    show() { active = true; resize(); dirty = true; redraw(); },
    hide() { active = false; tooltip(null); },
  };
}
