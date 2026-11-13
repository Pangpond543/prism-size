// Treemap — nested glass tiles, area = size. Drag a tile onto a folder tile to move it for real.
import { T } from './i18n.js';
import {
  state, bus, api, childrenOf, isDir, colorOf, rgba, fmt, fmtPct, fmtNum, displayName, esc, clamp, ease,
  moveNode, select, setFocus, showNodeMenu, pathOf, tooltip, isAncestor,
} from './core.js';

let canvas, ctx, W = 0, H = 0, dpr = 1, active = false, raf = 0;
let rects = [], hover = null, anim = 0, animStart = 0, dirty = true;
let drag = null, dropT = null, skipAnim = false, wheelAt = 0;
const ghost = () => document.getElementById('ghost');
const PAD = { l: 92, t: 80, r: 18, b: 74 };
const MAX_DEPTH = 5, HEAD = 19;

function squarify(items, x, y, w, h) {
  const out = [];
  let total = 0;
  for (const it of items) total += it.v;
  if (total <= 0 || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  let i = 0;
  while (i < items.length) {
    const short = Math.min(w, h);
    let sum = 0, best = Infinity, max = 0, min = Infinity, j = i;
    while (j < items.length) {
      const a = items[j].v * scale, ns = sum + a, mx = Math.max(max, a), mn = Math.min(min, a);
      const worst = Math.max((short * short * mx) / (ns * ns), (ns * ns) / (short * short * mn));
      if (j > i && worst > best) break;
      best = worst; sum = ns; max = mx; min = mn; j++;
    }
    const thick = sum / short;
    let off = 0;
    for (let k = i; k < j; k++) {
      const len = (items[k].v * scale) / thick;
      if (w >= h) out.push({ node: items[k].node, x, y: y + off, w: thick, h: len });
      else out.push({ node: items[k].node, x: x + off, y, w: len, h: thick });
      off += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    i = j;
  }
  return out;
}

function compute() {
  rects = [];
  dirty = false;
  const root = state.focus;
  if (!root || !root.s) return;
  const walk = (dir, x, y, w, h, depth) => {
    const items = [];
    for (const c of childrenOf(dir)) if (c.s > 0) items.push({ node: c, v: c.s });
    if (dir.rs > 0) {
      if (!dir._agg) dir._agg = { agg: true, n: '…', p: dir };
      dir._agg.s = dir.rs; dir._agg.count = dir.rc;
      items.push({ node: dir._agg, v: dir.rs });
      items.sort((a, b) => b.v - a.v);
    }
    for (const r of squarify(items, x, y, w, h)) {
      if (r.w < 2.5 || r.h < 2.5) continue;
      r.depth = depth;
      const g = depth === 0 ? 3 : 1.5; // gap between tiles
      r.x += g; r.y += g; r.w -= g * 2; r.h -= g * 2;
      if (r.w < 2 || r.h < 2) continue;
      rects.push(r);
      const n = r.node;
      if (isDir(n) && depth < MAX_DEPTH && r.w > 34 && r.h > 34 && (n.d.length || (n._fo ? n._fo.length : n.f.length))) {
        r.head = r.w > 70 && r.h > 52;
        const top = r.head ? HEAD : 3;
        walk(n, r.x + 3, r.y + top, r.w - 6, r.h - top - 3, depth + 1);
        r.container = true;
      }
    }
  };
  walk(root, PAD.l, PAD.t, W - PAD.l - PAD.r - (document.body.classList.contains('has-insp') ? 344 : 0), H - PAD.t - PAD.b, 0);
  anim = 0; animStart = skipAnim ? -1e9 : performance.now(); skipAnim = false;
}

function draw(now) {
  raf = 0;
  if (!active) return;
  if (dirty) compute();
  anim = clamp((now - animStart) / 900, 0, 1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  const cx = W / 2, cy = H / 2;
  for (const r of rects) {
    const t = ease(clamp(anim * 1.6 - r.depth * 0.12, 0, 1));
    if (t <= 0) continue;
    // tiles fly in from the centre
    const x = cx + (r.x - cx) * (0.86 + 0.14 * t) + (1 - t) * 0, y = cy + (r.y - cy) * (0.86 + 0.14 * t);
    const w = r.w * (0.86 + 0.14 * t), h = r.h * (0.86 + 0.14 * t);
    const n = r.node, c = colorOf(n);
    const rad = Math.min(12 - r.depth * 1.5, w / 2, h / 2, 12);
    const hot = hover === r || (drag && drag.r === r);
    ctx.globalAlpha = t * (drag && drag.r === r && drag.active ? 0.35 : 1);
    ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(2, rad));
    if (r.container) {
      ctx.fillStyle = rgba(c, hot ? 0.3 : 0.16); ctx.fill();
      const g = ctx.createLinearGradient(x, y, x, y + Math.min(h, 60));
      g.addColorStop(0, 'rgba(255,255,255,.42)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fill();
    } else {
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, `rgba(255,255,255,${hot ? 0.95 : 0.8})`);
      g.addColorStop(0.5, rgba(c, hot ? 0.82 : 0.62));
      g.addColorStop(1, rgba(c, hot ? 0.98 : 0.86));
      ctx.fillStyle = g; ctx.fill();
      if (w > 14 && h > 14) { // sheen
        const s = ctx.createLinearGradient(x, y, x, y + h * 0.5);
        s.addColorStop(0, 'rgba(255,255,255,.5)'); s.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = s; ctx.beginPath(); ctx.roundRect(x + 1.5, y + 1.5, w - 3, h * 0.5, Math.max(2, rad - 1)); ctx.fill();
        ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(2, rad));
      }
    }
    ctx.lineWidth = hot ? 2 : 1;
    ctx.strokeStyle = hot ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,.85)';
    ctx.stroke();
    if (r === dropT) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(63,207,164,.95)'; ctx.stroke(); }
    if (state.selected === n) { ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(124,140,255,.95)'; ctx.stroke(); }
    // labels
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 2, y, w - 4, h); ctx.clip();
    if (r.container) {
      if (r.head) {
        ctx.font = '650 11.5px "Segoe UI Variable Display","Segoe UI","Leelawadee UI",sans-serif';
        ctx.fillStyle = 'rgba(35,42,71,.88)'; ctx.textAlign = 'left';
        const label = displayName(n);
        ctx.fillText(label, x + 8, y + HEAD / 2 + 1);
        const lw = ctx.measureText(label).width;
        if (w > lw + 80) { ctx.font = '500 10.5px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(74,83,118,.8)'; ctx.fillText(fmt(n.s), x + 14 + lw, y + HEAD / 2 + 1); }
      }
    } else if (w > 46 && h > 22) {
      const fs = clamp(Math.min(w / 9, h / 3), 10.5, 17);
      ctx.textAlign = 'center';
      ctx.font = `650 ${fs}px "Segoe UI Variable Display","Segoe UI","Leelawadee UI",sans-serif`;
      ctx.fillStyle = 'rgba(35,42,71,.9)';
      let name = displayName(n);
      const maxChars = Math.floor(w / (fs * 0.56));
      if (name.length > maxChars) name = name.slice(0, Math.max(3, maxChars - 1)) + '…';
      const two = h > fs * 2.9;
      ctx.fillText(name, x + w / 2, y + h / 2 - (two ? fs * 0.55 : 0));
      if (two) { ctx.font = `500 ${Math.max(10, fs * 0.78)}px "Segoe UI",sans-serif`; ctx.fillStyle = 'rgba(74,83,118,.9)'; ctx.fillText(fmt(n.s), x + w / 2, y + h / 2 + fs * 0.62); }
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (!rects.length && state.focus) {
    ctx.textAlign = 'center'; ctx.font = '600 15px "Segoe UI","Leelawadee UI",sans-serif'; ctx.fillStyle = 'rgba(74,83,118,.8)';
    ctx.fillText(T`โฟลเดอร์นี้ว่างเปล่า`, W / 2, H / 2);
  }
  if (anim < 1 || drag) raf = requestAnimationFrame(draw);
}
const redraw = () => { if (active && !raf) raf = requestAnimationFrame(draw); };

function hit(x, y, filter) {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h && (!filter || filter(r))) return r;
  }
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

export function initTreemap() {
  canvas = document.getElementById('treemap-canvas');
  ctx = canvas.getContext('2d');
  new ResizeObserver(resize).observe(canvas);
  canvas.style.cursor = 'default';
  let gx = 0, gy = 0, tx = 0, ty = 0, gl = 0;
  const ghostLoop = () => { // the chip trails the pointer with a little inertia
    gl = 0;
    if (!drag || !drag.active) return;
    gx += (tx - gx) * 0.24; gy += (ty - gy) * 0.24;
    ghost().style.transform = `translate3d(${gx + 14}px,${gy + 14}px,0) rotate(${clamp((tx - gx) * 0.12, -8, 8)}deg)`;
    gl = requestAnimationFrame(ghostLoop);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [x, y] = local(e); const r = hit(x, y);
    if (!r) return;
    drag = { r, sx: x, sy: y, active: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    if (drag) {
      if (!drag.active && Math.hypot(x - drag.sx, y - drag.sy) > 6 && !drag.r.node.agg) {
        drag.active = true; tooltip(null);
        const g = ghost(); g.textContent = displayName(drag.r.node); g.classList.remove('hidden');
        gx = tx = e.clientX; gy = ty = e.clientY;
        if (!gl) gl = requestAnimationFrame(ghostLoop);
      }
      if (drag.active) {
        tx = e.clientX; ty = e.clientY;
        const n = drag.r.node;
        dropT = hit(x, y, (r) => r !== drag.r && isDir(r.node) && r.node !== n.p && !(isDir(n) && isAncestor(n, r.node)));
        ghost().classList.toggle('ok', !!dropT);
        redraw();
      }
      return;
    }
    const r = hit(x, y);
    if (r !== hover) { hover = r; redraw(); }
    canvas.style.cursor = r ? 'pointer' : 'default';
    if (r) {
      const n = r.node;
      tooltip(`<b>${esc(displayName(n))}</b><span>${T`${fmt(n.s)} · ${fmtPct(n.s, state.focus.s)} ของมุมมองนี้${isDir(n) ? T` · ${fmtNum(n.c)} ไฟล์` : ''}`}</span>`, e.clientX, e.clientY);
    } else tooltip(null);
  });
  const up = async () => {
    const d = drag, t = dropT;
    drag = null; dropT = null;
    ghost().classList.add('hidden'); ghost().classList.remove('ok');
    if (!d) return;
    if (d.active) { if (t) await moveNode(d.r.node, t.node); redraw(); return; }
    if (!d.r.node.agg) select(d.r.node);
    redraw();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { if (!drag) { hover = null; tooltip(null); redraw(); } });
  canvas.addEventListener('dblclick', (e) => {
    const r = hit(...local(e));
    if (!r) return;
    if (isDir(r.node)) setFocus(r.node); else if (r.node.file) api.invoke('fs:open', pathOf(r.node));
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault(); tooltip(null);
    const r = hit(...local(e));
    if (r) showNodeMenu(r.node, e.clientX, e.clientY);
  });
  canvas.addEventListener('wheel', (e) => { // wheel up over a folder → dive in, wheel down → go up
    const now = performance.now(); if (now - wheelAt < 450) return; wheelAt = now;
    if (e.deltaY < 0) { const r = hit(...local(e), (q) => q.depth === 0 && isDir(q.node)); if (r) setFocus(r.node); }
    else if (state.focus && state.focus.p) setFocus(state.focus.p);
  }, { passive: true });
  bus.on('focus', () => { dirty = true; redraw(); });
  bus.on('model', () => { dirty = true; redraw(); });
  bus.on('select', () => { if (!dirty) skipAnim = true; dirty = true; redraw(); });
  return {
    show() { active = true; resize(); dirty = true; redraw(); },
    hide() { active = false; tooltip(null); },
  };
}
