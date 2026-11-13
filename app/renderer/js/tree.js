// Space tree — glass orbs in a force-directed graph. Drag an orb onto a folder to move the real file.
import { T } from './i18n.js';
import {
  state, bus, api, childrenOf, isDir, colorOf, rgba, fmt, fmtNum, fmtPct, displayName, esc, clamp, catOf,
  moveNodes, select, selectMany, showNodeMenu, pathOf, loadAllFiles, tooltip, isAncestor, toast, theme,
} from './core.js';

const PAGE = 14;            // children revealed per expansion step
const R_ROOT = 78;          // world radius of the focus node
const GAP = 12;             // breathing room between orbs
const KS = 36, DAMP = 5.2;  // link spring / velocity damping → loose, slightly bouncy (graph-view feel)
const SOFT = 34;            // soft repulsion zone beyond touching distance

let canvas, ctx, W = 0, H = 0, dpr = 1, active = false, raf = 0, last = 0, time = 0;
let rootV = null, all = [];
const vmap = new WeakMap(); // data node → visual node (so orbs keep their position when re-parented)
const cam = { x: 0, y: 0, z: 1, tz: 1, vx: 0, vy: 0, tx: null, ty: null };
const ptr = { x: 0, y: 0, wx: 0, wy: 0, down: false, sx: 0, sy: 0, moved: false, pan: false, lt: 0 };
let drag = null, hover = null, dropT = null, dust = [], follow = null, box = null;

/* ----------------------------------------------------------- visual nodes */
function radius(n) {
  const total = state.focus.s || 1;
  return Math.max(n.agg ? 10 : 8, R_ROOT * Math.sqrt((n.s || 0) / total));
}
function mk(node, parent) {
  let v = vmap.get(node);
  if (!v) {
    v = { node, kids: [], x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, px: 0, py: 0, sx: 0, sy: 0, r: 2, tr: 10, rest: 0, slot: 0, edge: 10, m: 1, expanded: false, limit: PAGE, alpha: 0, seed: Math.random() * 100, depth: 0, parent: null, fresh: true, place: false, openedAt: 0 };
    vmap.set(node, v);
  }
  if (v.fresh || v.dead) { v.vx = v.vy = 0; v.r = 2; v.alpha = 0; v.fresh = false; v.dead = false; v.place = true; }
  v.parent = parent; v.depth = parent ? parent.depth + 1 : 0;
  v.tr = node === state.focus ? R_ROOT : radius(node);
  return v;
}
function kill(v) { v.dead = true; v.expanded = false; for (const k of v.kids) kill(k); v.kids = []; }

function syncKids(v) {
  if (!v.expanded) { for (const k of v.kids) kill(k); v.kids = []; return; }
  const ch = childrenOf(v.node);
  const shown = ch.slice(0, v.limit);
  const old = new Set(v.kids);
  const kids = shown.map((n) => { const k = mk(n, v); old.delete(k); return k; });
  const restN = ch.length - shown.length + (v.node.rc || 0);
  if (restN > 0) {
    let rs = v.node.rs || 0;
    for (let i = shown.length; i < ch.length; i++) rs += ch[i].s;
    if (!v.aggNode) v.aggNode = { agg: true, n: '…', s: 0, count: 0, p: v.node };
    v.aggNode.s = rs; v.aggNode.count = restN;
    const a = mk(v.aggNode, v); old.delete(a); kids.push(a);
  }
  for (const k of old) kill(k);
  v.kids = kids;
  for (const k of kids) if (k.expanded && isDir(k.node)) syncKids(k); else if (k.kids.length) { for (const g of k.kids) kill(g); k.kids = []; k.expanded = false; }
}
function collect() {
  all = [];
  const walk = (v) => { all.push(v); for (const k of v.kids) walk(k); };
  if (rootV) walk(rootV);
}

/* ------------------------------------------------------------------ layout */
// Children sit on several concentric rows around their folder (big ones inside). An opened child
// floats just outside those rows with its own rows around it — distance grows by addition, never
// by multiplication. Only the *distance* to the parent is prescribed; angles are left to the physics.
function layout() {
  if (!rootV) return;
  const post = (v) => {
    for (const k of v.kids) post(k);
    v.edge = v.tr;
    if (!v.kids.length) { v.m = v.tr * v.tr; return; }
    const plain = v.kids.filter((k) => !k.kids.length).sort((a, b) => b.tr - a.tr);
    const open = v.kids.filter((k) => k.kids.length);
    const base = v.parent ? Math.atan2(v.y - v.parent.y, v.x - v.parent.x) : -Math.PI / 2;
    let i = 0, ring = 0, edge = v.tr, reach = v.tr;
    while (i < plain.length) {
      // a row is spaced by its *typical* orb, not its biggest — one giant must not push the whole row out;
      // the giant simply sits a little further and its small neighbours tuck in beside it
      const cap = 7 + ring * 6;
      let j = i, used = 0, sum = 0;
      while (j < plain.length && j - i < cap) {
        const avg = (sum + plain[j].tr) / (j - i + 1), need = plain[j].tr * 2 + GAP;
        if (j > i && used + need > Math.PI * 2 * (edge + GAP + avg)) break;
        used += need; sum += plain[j].tr; j++;
      }
      const cnt = j - i, avg = sum / cnt, dist = edge + GAP + avg;
      for (let q = i; q < j; q++) {
        const k = plain[q];
        k.rest = Math.max(dist, v.tr + GAP + k.tr);
        k.slot = base + ((q - i) / cnt) * Math.PI * 2 + ring * 0.55;
        reach = Math.max(reach, k.rest + k.tr);
      }
      edge = dist + avg; i = j; ring++;
    }
    edge = Math.max(edge, reach);
    v.edge = edge;
    open.forEach((k, q) => { k.rest = edge + GAP + k.edge; if (k.place) k.slot = base + (q / Math.max(1, open.length)) * Math.PI * 2; });
    v.m = v.edge * v.edge;
  };
  post(rootV);
  for (const v of all) { // newborn orbs pop out of their folder toward their slot
    if (!v.place) continue;
    v.place = false;
    const p = v.parent;
    if (!p) continue;
    const d = p.r * 0.5 + 4;
    v.x = p.x + Math.cos(v.slot) * d; v.y = p.y + Math.sin(v.slot) * d;
    v.vx = p.vx + Math.cos(v.slot) * 60; v.vy = p.vy + Math.sin(v.slot) * 60;
  }
}

const insetX = () => (92 - (document.body.classList.contains('has-insp') ? 344 : 0)) / 2; // dock on the left, inspector on the right
function fitZoom(rad) { return Math.min(W - 92 - 60 - (document.body.classList.contains('has-insp') ? 344 : 0), H - 200) / (2 * (rad + 40)); }

function build() {
  if (rootV) kill(rootV);
  follow = null;
  if (!state.focus) { rootV = null; all = []; return; }
  rootV = mk(state.focus, null);
  rootV.x = rootV.y = 0; rootV.vx = rootV.vy = 0; rootV.place = false;
  rootV.expanded = true;
  syncKids(rootV); collect(); layout();
  const z = clamp(fitZoom(rootV.edge + 30), 0.2, 1.5);
  cam.z = z * 0.6; cam.tz = z; cam.vx = cam.vy = 0; cam.tx = null;
  cam.x = -insetX() / z; cam.y = 0;
}
function refresh() {
  if (!rootV || rootV.node !== state.focus) { build(); return; }
  syncKids(rootV); collect(); layout();
}
// keep the camera on a folder for a moment after it opens, so the view travels with it
function track(v, ms = 1500) {
  follow = { v, until: performance.now() + ms };
  const fz = fitZoom(v.edge + 20);
  if (cam.tz > fz) cam.tz = clamp(fz, 0.12, 2);
  else if (cam.tz < fz * 0.4) cam.tz = clamp(fz * 0.7, 0.12, 1.4);
  cam.vx = cam.vy = 0;
}
function toggle(v, open = !v.expanded) {
  if (!isDir(v.node) || v === rootV || v.expanded === open) return;
  v.expanded = open;
  if (open) { v.limit = PAGE; v.openedAt = performance.now(); }
  syncKids(v); collect(); layout();
  if (open && v.kids.length) track(v);
}
async function more(v) { // v is the "+N more" orb
  const p = v.parent;
  const ch = childrenOf(p.node);
  if (p.limit >= ch.length && p.node.rc) { await loadAllFiles(p.node); toast(T`โหลดไฟล์ทั้งหมดใน “${displayName(p.node)}” แล้ว`); }
  p.limit += PAGE;
  syncKids(p); collect(); layout();
}

/* ----------------------------------------------------------------- physics */
const held = (v) => drag && drag.active && drag.set.has(v);
function related(a, b) { // is one an ancestor of the other? returns the ancestor
  if (a.depth === b.depth) return null;
  const hi = a.depth < b.depth ? a : b; let lo = hi === a ? b : a;
  while (lo && lo.depth > hi.depth) lo = lo.parent;
  return lo === hi ? hi : null;
}
function step(dt) {
  time += dt;
  // camera: smooth zoom + inertial pan, or riding along with a freshly opened folder
  cam.z += (cam.tz - cam.z) * Math.min(1, dt * 8);
  if (follow) {
    const v = follow.v;
    if (v.dead || performance.now() > follow.until) follow = null;
    else { cam.tx = v.x - insetX() / cam.tz; cam.ty = v.y; }
  }
  if (cam.tx !== null) {
    cam.x += (cam.tx - cam.x) * Math.min(1, dt * 4.5); cam.y += (cam.ty - cam.y) * Math.min(1, dt * 4.5);
    if (!follow && Math.abs(cam.tx - cam.x) + Math.abs(cam.ty - cam.y) < 0.5) cam.tx = null;
  } else if (!ptr.pan) {
    cam.x += cam.vx * dt; cam.y += cam.vy * dt;
    const f = Math.pow(0.04, dt); cam.vx *= f; cam.vy *= f;
  }
  const n = all.length;
  for (let i = 0; i < n; i++) {
    const v = all[i];
    v.r += (v.tr - v.r) * Math.min(1, dt * 7);
    v.alpha += (1 - v.alpha) * Math.min(1, dt * 6);
    v.ax = v.ay = v.px = v.py = 0;
  }
  // links: springs that only care about distance, so branches swing freely
  for (let i = 1; i < n; i++) {
    const v = all[i], p = v.parent;
    let dx = v.x - p.x, dy = v.y - p.y, d = Math.hypot(dx, dy);
    if (d < 0.01) { dx = Math.cos(v.slot); dy = Math.sin(v.slot); d = 1; }
    const ux = dx / d, uy = dy / d, f = (d - v.rest) * KS;
    v.ax -= ux * f; v.ay -= uy * f;
    if (!held(p)) { const k = held(v) ? 0.5 : Math.min(0.3, v.m / p.m); p.ax += ux * f * k; p.ay += uy * f * k; }
    const g = p.parent; // opened folders drift away from their grandparent → the tree unfolds outward
    if (g && v.kids.length) { const ex = v.x - g.x, ey = v.y - g.y, el = Math.hypot(ex, ey) || 1; v.ax += (ex / el) * 90; v.ay += (ey / el) * 90; }
  }
  // bodies: every orb (or a whole opened cluster) keeps its own space
  for (let i = 0; i < n; i++) {
    const a = all[i], ba = a.kids.length ? a.edge : a.r;
    for (let j = i + 1; j < n; j++) {
      const b = all[j], bb = b.kids.length ? b.edge : b.r;
      const dx = b.x - a.x, dy = b.y - a.y, reach = ba + bb + GAP + SOFT;
      if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) continue;
      const anc = related(a, b);
      if (anc && (a.parent === b || b.parent === a) && !(anc === a ? b : a).kids.length) continue; // plain child ↔ its own parent: the link handles it
      const min = (anc === a ? a.r : ba) + (anc === b ? b.r : bb) + GAP;
      const d = Math.sqrt(d2) || 0.01, nx = dx / d, ny = dy / d;
      let wa = held(a) || !a.parent || anc === a ? 0 : 1 / a.m, wb = held(b) || !b.parent || anc === b ? 0 : 1 / b.m;
      const ws = wa + wb;
      if (!ws) continue;
      wa /= ws; wb /= ws;
      if (d < min) {
        const o = min - d, c = o * 0.28, kick = o * 26;
        a.px -= nx * c * wa; a.py -= ny * c * wa; b.px += nx * c * wb; b.py += ny * c * wb;
        a.ax -= nx * kick * wa; a.ay -= ny * kick * wa; b.ax += nx * kick * wb; b.ay += ny * kick * wb;
      } else {
        const s = (min + SOFT - d) * 2.2;
        a.ax -= nx * s * wa; a.ay -= ny * s * wa; b.ax += nx * s * wb; b.ay += ny * s * wb;
      }
    }
  }
  const damp = Math.exp(-DAMP * dt);
  for (let i = 0; i < n; i++) {
    const v = all[i], p = v.parent;
    v.sx = v.px + (p ? p.sx : 0); v.sy = v.py + (p ? p.sy : 0); // a pushed cluster carries its children along
    if (held(v)) { v.sx = v.sy = 0; continue; }
    v.vx = clamp((v.vx + v.ax * dt) * damp, -3000, 3000); v.vy = clamp((v.vy + v.ay * dt) * damp, -3000, 3000);
    v.x += v.vx * dt + v.sx; v.y += v.vy * dt + v.sy;
  }
}

/* ------------------------------------------------------------- projection */
// Faint picture inside each file orb: real thumbnail for images, cover frame for videos, system icon otherwise.
const thumbs = new Map(); // key → { st: 'q' | 'ok' | 'fail', img }
const queue = []; let busy = 0;
const MEDIA = new Set(['image', 'video']);
function pump() {
  while (busy < 3 && queue.length) {
    const job = queue.shift(); busy++;
    api.invoke(job.kind === 'media' ? 'thumb:get' : 'app:icon', job.path, 256).then((url) => {
      if (!url) { job.e.st = 'fail'; return; }
      const img = new Image();
      img.onload = () => { job.e.img = img; job.e.st = 'ok'; };
      img.onerror = () => { job.e.st = 'fail'; };
      img.src = url; job.e.url = url;
    }).catch(() => { job.e.st = 'fail'; }).finally(() => { busy--; pump(); });
  }
}
function projection(n) {
  if (!n.file) return null;
  const cat = catOf(n.n), media = MEDIA.has(cat);
  const kind = media && state.proj.media ? 'media' : (!media && state.proj.icon ? 'icon' : null);
  if (!kind) return null;
  const path = pathOf(n), key = kind + '|' + path;
  let e = thumbs.get(key);
  if (!e) {
    e = { st: 'q', img: null, url: '', kind, video: cat === 'video' };
    thumbs.set(key, e);
    if (queue.length < 400) queue.push({ kind, path, e }); else thumbs.delete(key);
    pump();
  }
  return e;
}

/* ------------------------------------------------------------------ render */
const toScreen = (wx, wy) => [(wx - cam.x) * cam.z + W / 2, (wy - cam.y) * cam.z + H / 2];
const toWorld = (sx, sy) => [(sx - W / 2) / cam.z + cam.x, (sy - H / 2) / cam.z + cam.y];

function folderGlyph(x, y, r, a) {
  const w = r * 1.02, h = w * 0.76, x0 = x - w / 2, y0 = y - h / 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x0 + w * 0.36, y0); ctx.lineTo(x0 + w * 0.47, y0 + h * 0.17); ctx.lineTo(x0 + w, y0 + h * 0.17);
  ctx.lineTo(x0 + w, y0 + h); ctx.lineTo(x0, y0 + h); ctx.closePath();
  ctx.lineJoin = 'round'; ctx.lineWidth = r * 0.09;
  ctx.fillStyle = `rgba(255,255,255,${0.2 * a})`; ctx.strokeStyle = `rgba(255,255,255,${0.2 * a})`;
  ctx.fill(); ctx.stroke();
  ctx.lineWidth = r * 0.022; ctx.strokeStyle = `rgba(52,62,112,${0.1 * a})`;
  ctx.beginPath(); ctx.moveTo(x0, y0 + h * 0.34); ctx.lineTo(x0 + w, y0 + h * 0.34); ctx.stroke();
}

function orb(v, x, y) {
  const n = v.node, r = Math.max(0.5, v.r), c = colorOf(n), a = Math.max(0, Math.min(1, v.alpha));
  const file = n.file, sr = r * cam.z;
  const shape = () => {
    ctx.beginPath();
    if (file) ctx.roundRect(x - r, y - r, r * 2, r * 2, r * 0.42);
    else ctx.arc(x, y, r, 0, Math.PI * 2);
  };
  // halo
  let g = ctx.createRadialGradient(x, y, r * 0.7, x, y, r * 1.7);
  g.addColorStop(0, rgba(c, 0.34 * a)); g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.7, 0, Math.PI * 2); ctx.fill();
  // glass body
  g = ctx.createRadialGradient(x - r * 0.36, y - r * 0.42, r * 0.05, x, y, r * 1.05);
  const open = v.expanded && v.kids.length;
  g.addColorStop(0, `rgba(255,255,255,${0.95 * a})`);
  g.addColorStop(0.42, rgba(c, (open ? 0.36 : 0.62) * a));
  g.addColorStop(1, rgba(c, (open ? 0.6 : 0.9) * a));
  ctx.fillStyle = g; shape(); ctx.fill();
  // what is inside: a ghost of the picture / icon, or a whisper of a folder
  const pr = sr > 9 ? projection(n) : null;
  if (pr && pr.st === 'ok') {
    const im = pr.img;
    ctx.save();
    if (pr.kind === 'media') {
      shape(); ctx.clip();
      ctx.globalAlpha = 0.6 * a;
      const k = Math.max((r * 2) / im.width, (r * 2) / im.height), w = im.width * k, h = im.height * k;
      ctx.drawImage(im, x - w / 2, y - h / 2, w, h);
      g = ctx.createRadialGradient(x - r * 0.36, y - r * 0.42, 0, x, y, r * 1.2); // keep it glassy
      g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(0.55, 'rgba(255,255,255,0)');
      ctx.globalAlpha = a; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    } else {
      ctx.globalAlpha = 0.62 * a;
      const s = r * 1.1;
      ctx.drawImage(im, x - s / 2, y - s / 2, s, s);
    }
    ctx.restore();
    if (pr.video && sr > 15) { // marked as a video: play badge
      const br = r * 0.3;
      ctx.fillStyle = `rgba(30,36,64,${0.62 * a})`; ctx.beginPath(); ctx.arc(x, y, br, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.95 * a})`;
      ctx.beginPath(); ctx.moveTo(x - br * 0.32, y - br * 0.48); ctx.lineTo(x + br * 0.52, y); ctx.lineTo(x - br * 0.32, y + br * 0.48); ctx.closePath(); ctx.fill();
    }
  } else if (!file && !n.agg && sr > 9) folderGlyph(x, y, r, a);
  // refracted light pooled at the bottom-right
  g = ctx.createRadialGradient(x + r * 0.32, y + r * 0.42, 0, x + r * 0.32, y + r * 0.42, r * 0.62);
  g.addColorStop(0, `rgba(255,255,255,${0.5 * a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; shape(); ctx.fill();
  // rim
  ctx.lineWidth = Math.max(1 / cam.z, r * 0.045);
  ctx.strokeStyle = `rgba(255,255,255,${0.95 * a})`;
  if (n.agg) ctx.setLineDash([r * 0.3, r * 0.22]);
  shape(); ctx.stroke(); ctx.setLineDash([]);
  // specular
  ctx.fillStyle = `rgba(255,255,255,${0.78 * a})`;
  ctx.beginPath(); ctx.ellipse(x - r * 0.36, y - r * 0.46, r * 0.3, r * 0.15, -0.6, 0, Math.PI * 2); ctx.fill();
  if (open) { // expanded folders wear an orbit ring
    ctx.lineWidth = Math.max(1 / cam.z, r * 0.03);
    ctx.strokeStyle = rgba(c, 0.55 * a);
    ctx.beginPath(); ctx.arc(x, y, r * 1.22, time * 0.4 + v.seed, time * 0.4 + v.seed + Math.PI * 1.5); ctx.stroke();
  }
}

function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  // drifting dust with parallax → depth
  for (const d of dust) {
    const px = ((d.x - cam.x * d.z * 0.12 + time * d.vx) % (W + 40) + W + 40) % (W + 40) - 20;
    const py = ((d.y - cam.y * d.z * 0.12 + time * d.vy) % (H + 40) + H + 40) % (H + 40) - 20;
    ctx.fillStyle = `rgba(255,255,255,${(0.35 + 0.35 * Math.sin(time * d.tw + d.x)) * theme.dust})`;
    ctx.beginPath(); ctx.arc(px, py, d.r, 0, Math.PI * 2); ctx.fill();
  }
  if (!rootV) return;
  ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * (W / 2 - cam.x * cam.z), dpr * (H / 2 - cam.y * cam.z));
  const fl = (v) => (held(v) ? [v.x, v.y] : [v.x + Math.sin(time * 0.55 + v.seed) * 2.4, v.y + Math.cos(time * 0.47 + v.seed * 1.7) * 2.4]);
  // branches
  ctx.lineCap = 'round';
  for (const v of all) {
    if (!v.parent) continue;
    const p = v.parent, [x1, y1] = fl(p), [x2, y2] = fl(v);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1;
    const bend = 0.1 * Math.sin(v.seed * 7);
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, `rgba(${theme.branch},${0.8 * v.alpha})`); g.addColorStop(1, rgba(colorOf(v.node), 0.7 * v.alpha));
    ctx.strokeStyle = g; ctx.lineWidth = clamp(v.r * 0.16, 1 / cam.z, 7);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx - dy * bend, my + dx * bend, x2, y2); ctx.stroke();
  }
  // orbs (parents first, dragged orbs last)
  const vw = W / cam.z / 2 + 120, vh = H / cam.z / 2 + 120;
  const visible = [], top = [];
  for (const v of all) {
    if (held(v)) { top.push(v); continue; }
    const [x, y] = fl(v);
    if (Math.abs(x - cam.x) - v.r > vw || Math.abs(y - cam.y) - v.r > vh) continue;
    orb(v, x, y); visible.push([v, x, y]);
  }
  if (dropT) {
    const [x, y] = fl(dropT), pulse = 1 + 0.08 * Math.sin(time * 9);
    ctx.lineWidth = 3 / cam.z; ctx.strokeStyle = 'rgba(63,207,164,.95)';
    ctx.shadowColor = 'rgba(63,207,164,.9)'; ctx.shadowBlur = 24;
    ctx.beginPath(); ctx.arc(x, y, (dropT.r + 9 / cam.z) * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
  }
  for (const [v, x, y] of visible) { // selection rings (one per selected orb)
    if (!state.multi.has(v.node)) continue;
    ctx.lineWidth = 2 / cam.z; ctx.strokeStyle = 'rgba(124,140,255,.95)';
    ctx.setLineDash([7 / cam.z, 6 / cam.z]); ctx.lineDashOffset = -time * 22 / cam.z;
    ctx.beginPath(); ctx.arc(x, y, v.r + 7 / cam.z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const v of top) { ctx.globalAlpha = 0.92; orb(v, v.x, v.y); ctx.globalAlpha = 1; visible.push([v, v.x, v.y]); }

  // labels in screen space (crisp at any zoom)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [v, wx, wy] of visible) {
    const sr = v.r * cam.z;
    const hot = v === hover || held(v) || v === dropT || state.multi.has(v.node);
    if (sr < 13 && !hot) continue;
    const [sx, sy] = toScreen(wx, wy);
    let name = displayName(v.node);
    if (name.length > 26) name = name.slice(0, 24) + '…';
    const a = v.alpha * (hot ? 1 : clamp((sr - 13) / 8, 0, 1));
    const fs = clamp(sr * 0.3, 11, 15);
    if (sr > 40) { // size inside the orb
      ctx.font = `700 ${clamp(sr * 0.3, 12, 26)}px "Segoe UI Variable Display","Segoe UI",sans-serif`;
      ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = `rgba(255,255,255,${0.45 * a})`;
      ctx.strokeText(fmt(v.node.s), sx, sy + sr * 0.08);
      ctx.fillStyle = `rgba(35,42,71,${0.86 * a})`;
      ctx.fillText(fmt(v.node.s), sx, sy + sr * 0.08);
    }
    ctx.font = `600 ${fs}px "Segoe UI Variable Display","Segoe UI","Leelawadee UI",sans-serif`;
    const ly = sy + sr + fs * 0.95;
    ctx.lineWidth = 3.5; ctx.strokeStyle = `rgba(${theme.paper},${0.8 * a})`; ctx.lineJoin = 'round';
    ctx.strokeText(name, sx, ly);
    ctx.fillStyle = `rgba(${theme.ink},${0.92 * a})`;
    ctx.fillText(name, sx, ly);
    if (sr <= 40) {
      ctx.font = '500 10.5px "Segoe UI",sans-serif';
      ctx.strokeText(fmt(v.node.s), sx, ly + fs * 1.05);
      ctx.fillStyle = `rgba(${theme.ink2},${0.9 * a})`;
      ctx.fillText(fmt(v.node.s), sx, ly + fs * 1.05);
    }
  }
  if (dropT && drag) {
    const [sx, sy] = toScreen(dropT.x, dropT.y);
    const text = drag.group.length > 1 ? T`ปล่อยเพื่อย้าย ${drag.group.length} รายการมาไว้ใน “${displayName(dropT.node)}”` : T`ปล่อยเพื่อย้ายมาไว้ใน “${displayName(dropT.node)}”`;
    ctx.font = '650 12.5px "Segoe UI","Leelawadee UI",sans-serif';
    const tw = ctx.measureText(text).width + 24, ty = sy - dropT.r * cam.z - 26;
    ctx.fillStyle = 'rgba(63,207,164,.95)'; ctx.beginPath(); ctx.roundRect(sx - tw / 2, ty - 13, tw, 26, 13); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(text, sx, ty + 0.5);
  }
  if (box) { // rubber-band selection
    const x = Math.min(box.x0, box.x1), y = Math.min(box.y0, box.y1), w = Math.abs(box.x1 - box.x0), h = Math.abs(box.y1 - box.y0);
    ctx.fillStyle = 'rgba(124,140,255,.14)'; ctx.strokeStyle = 'rgba(124,140,255,.9)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
  }
}

function frame(t) {
  raf = active ? requestAnimationFrame(frame) : 0;
  const dt = Math.max(0.001, Math.min(0.033, (t - last) / 1000 || 0.016)); last = t;
  step(dt * 0.5); step(dt * 0.5); // two sub-steps keep the springs stable
  draw();
}

/* ------------------------------------------------------------- interaction */
function hit(wx, wy, filter) {
  for (let i = all.length - 1; i >= 0; i--) {
    const v = all[i];
    if (filter && !filter(v)) continue;
    const dx = wx - v.x, dy = wy - v.y, r = Math.max(v.r, 9 / cam.z);
    if (dx * dx + dy * dy <= r * r) return v;
  }
  return null;
}
function local(e) { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; }

function onDown(e) {
  if (e.button !== 0) return;
  const [sx, sy] = local(e); const [wx, wy] = toWorld(sx, sy);
  ptr.down = true; ptr.sx = sx; ptr.sy = sy; ptr.x = sx; ptr.y = sy; ptr.moved = false; ptr.lt = performance.now();
  ptr.ctrl = e.ctrlKey || e.metaKey;
  canvas.setPointerCapture(e.pointerId);
  const v = hit(wx, wy);
  cam.tx = null; follow = null;
  if (v) {
    // dragging one of several selected orbs drags them all
    let group = [v];
    if (state.multi.size > 1 && state.multi.has(v.node)) group = all.filter((o) => state.multi.has(o.node) && o.parent && !o.node.agg);
    if (!group.includes(v)) group = [v];
    drag = { v, group: group.map((o) => ({ v: o, ox: o.x - wx, oy: o.y - wy })), set: new Set(group), active: false };
  } else if (e.shiftKey) box = { x0: sx, y0: sy, x1: sx, y1: sy };
  else { ptr.pan = true; cam.vx = cam.vy = 0; canvas.classList.add('grabbing'); }
  tooltip(null);
}
function onMove(e) {
  const [sx, sy] = local(e); const [wx, wy] = toWorld(sx, sy);
  const now = performance.now(), dt = Math.max(1, now - ptr.lt) / 1000;
  const dx = sx - ptr.x, dy = sy - ptr.y;
  ptr.x = sx; ptr.y = sy; ptr.wx = wx; ptr.wy = wy; ptr.lt = now;
  if (ptr.down && !ptr.moved && Math.hypot(sx - ptr.sx, sy - ptr.sy) > 5) { ptr.moved = true; if (drag) { drag.active = true; canvas.classList.add('grabbing'); } }
  if (ptr.down && ptr.moved) {
    if (drag) {
      for (const g of drag.group) {
        const v = g.v, nx = wx + g.ox, ny = wy + g.oy;
        v.vx = v.vx * 0.5 + ((nx - v.x) / dt) * 0.5; v.vy = v.vy * 0.5 + ((ny - v.y) / dt) * 0.5;
        v.x = nx; v.y = ny;
      }
      const movable = drag.group.filter((g) => g.v.parent && !g.v.node.agg);
      dropT = movable.length ? hit(wx, wy, (t) => !drag.set.has(t) && isDir(t.node)
        && movable.some((g) => t.node !== g.v.node.p) && !movable.some((g) => isDir(g.v.node) && isAncestor(g.v.node, t.node))) : null;
    } else if (box) { box.x1 = sx; box.y1 = sy; }
    else if (ptr.pan) {
      cam.x -= dx / cam.z; cam.y -= dy / cam.z;
      cam.vx = cam.vx * 0.6 + (-dx / cam.z / dt) * 0.4; cam.vy = cam.vy * 0.6 + (-dy / cam.z / dt) * 0.4;
    }
    return;
  }
  if (!ptr.down) {
    hover = hit(wx, wy);
    canvas.classList.toggle('pointing', !!hover);
    if (hover) {
      const n = hover.node, par = n.p;
      const sub = n.agg ? T`รวม ${fmt(n.s)} · คลิกเพื่อแสดงเพิ่ม`
        : `${fmt(n.s)}${par ? T` · ${fmtPct(n.s, par.s)} ของ “${esc(displayName(par))}”` : ''}${isDir(n) ? T` · ${fmtNum(n.c)} ไฟล์` : ''}`;
      const pr = projection(n);
      const pic = pr && pr.st === 'ok' && pr.kind === 'media' ? `<div class="tip-pic"><img src="${pr.url}" alt="">${pr.video ? '<em>VIDEO</em>' : ''}</div>` : '';
      tooltip(`${pic}<b>${esc(displayName(n))}</b><span>${sub}</span>`, e.clientX, e.clientY);
    } else tooltip(null);
  }
}
async function onUp() {
  if (!ptr.down) return;
  ptr.down = false; canvas.classList.remove('grabbing');
  const d = drag, target = dropT, b = box;
  drag = null; dropT = null; box = null;
  if (b) { // everything whose centre is inside the rubber band
    const [x0, y0] = toWorld(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1)), [x1, y1] = toWorld(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    if (ptr.moved) selectMany(all.filter((v) => v.parent && !v.node.agg && v.x >= x0 && v.x <= x1 && v.y >= y0 && v.y <= y1).map((v) => v.node));
    return;
  }
  if (ptr.pan) { ptr.pan = false; if (performance.now() - ptr.lt > 90) cam.vx = cam.vy = 0; if (!ptr.moved) select(null); return; }
  if (!d) return;
  const v = d.v;
  if (!ptr.moved) { // click
    v.vx = v.vy = 0;
    if (v.node.agg) { more(v); return; }
    if (ptr.ctrl) { select(v.node, true); return; }
    select(v.node);
    if (isDir(v.node) && !v.expanded) toggle(v, true); // opening is one click; closing takes a double-click
    return;
  }
  const still = performance.now() - ptr.lt > 90;
  for (const g of d.group) { if (still) g.v.vx = g.v.vy = 0; g.v.vx = clamp(g.v.vx, -2600, 2600); g.v.vy = clamp(g.v.vy, -2600, 2600); }
  const nodes = d.group.filter((g) => g.v.parent && !g.v.node.agg).map((g) => g.v.node);
  if (target && nodes.length) {
    const ok = await moveNodes(nodes, target.node); // the real move on disk
    if (ok && !target.expanded && target !== rootV) { target.expanded = true; target.limit = PAGE; syncKids(target); collect(); layout(); }
  }
}
function onWheel(e) {
  e.preventDefault();
  const [sx, sy] = local(e); const [wx, wy] = toWorld(sx, sy);
  const z = clamp(cam.tz * Math.exp(-e.deltaY * 0.0014), 0.06, 7);
  // keep the point under the cursor fixed while zooming
  const k = cam.z / z;
  follow = null;
  cam.tz = z; cam.tx = wx - (wx - cam.x) * k; cam.ty = wy - (wy - cam.y) * k;
  cam.vx = cam.vy = 0;
}
function fit() {
  if (!all.length) return;
  follow = null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of all) { x0 = Math.min(x0, v.x - v.r); y0 = Math.min(y0, v.y - v.r); x1 = Math.max(x1, v.x + v.r); y1 = Math.max(y1, v.y + v.r); }
  const ins = document.body.classList.contains('has-insp') ? 344 : 0;
  cam.tz = clamp(Math.min((W - 150 - ins) / (x1 - x0 + 80), (H - 220) / (y1 - y0 + 80)), 0.08, 2.2);
  cam.tx = (x0 + x1) / 2 - insetX() / cam.tz; cam.ty = (y0 + y1) / 2; cam.vx = cam.vy = 0;
}

// expand the chain of folders down to `node` and fly the camera there
function reveal(node) {
  if (!rootV || !node) return;
  const chain = [];
  for (let n = node; n && n !== state.focus; n = n.p) chain.unshift(n);
  if (node !== state.focus && (!chain.length || chain[0].p !== state.focus)) return;
  let v = rootV;
  for (const n of chain) {
    if (!v.expanded) v.expanded = true;
    const idx = childrenOf(v.node).indexOf(n);
    if (idx >= v.limit) v.limit = idx + 1;
    syncKids(v);
    const next = v.kids.find((k) => k.node === n);
    if (!next) break;
    v = next;
  }
  collect(); layout();
  select(node);
  const t = vmap.get(node);
  if (t && !t.dead) track(t.kids.length || !t.parent ? t : t.parent, 1800);
}

function resize() {
  const b = canvas.getBoundingClientRect();
  if (!b.width) return;
  W = b.width; H = b.height; dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
}

export function initTree() {
  canvas = document.getElementById('tree-canvas');
  ctx = canvas.getContext('2d');
  new ResizeObserver(resize).observe(canvas); resize();
  for (let i = 0; i < 70; i++) dust.push({ x: Math.random() * 2400, y: Math.random() * 1400, z: 0.3 + Math.random() * 1.6, r: 0.6 + Math.random() * 1.6, vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5, tw: 0.4 + Math.random() });
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', () => { if (!ptr.down) { hover = null; tooltip(null); } });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    const [sx, sy] = local(e); const v = hit(...toWorld(sx, sy));
    if (!v) fit();
    else if (v.node.file) api.invoke('fs:open', pathOf(v.node));
    else if (isDir(v.node) && v.expanded && performance.now() - v.openedAt > 600) toggle(v, false);
    else if (isDir(v.node) && v.expanded) track(v);
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const [sx, sy] = local(e); const v = hit(...toWorld(sx, sy));
    tooltip(null);
    if (v) showNodeMenu(v.node, e.clientX, e.clientY);
  });
  bus.on('focus', () => build());
  bus.on('model', () => refresh());
  bus.on('reveal', (node) => { if (state.view === 'tree') reveal(node); });
  bus.on('zoom', (k) => { if (state.view !== 'tree') return; if (k === 0) fit(); else { follow = null; cam.tz = clamp(cam.tz * k, 0.06, 7); } });
  return {
    show() { active = true; resize(); if (!rootV && state.focus) build(); last = performance.now(); if (!raf) raf = requestAnimationFrame(frame); },
    hide() { active = false; tooltip(null); },
    reveal,
  };
}
