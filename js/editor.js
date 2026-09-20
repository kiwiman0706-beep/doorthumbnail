// Collage editor: canvas preview, per-cell pan/zoom/rotate, layout & text controls.

import { db } from './db.js';
import { bitmapsFor, bitmap, thumbURL, importFiles } from './photos.js';
import { LAYOUTS, layoutCount, layoutHasSplit, syncCells, newCell, newFrame, frameSizePx, ymLabel, MONTHS } from './model.js';
import { renderFrame, cellRects, coverScale, renderToCanvas, canvasToBlob } from './render.js';
import { $, $$, toast, busy } from './ui.js';

const THUMB_W = 180;

let frame = null;
let imgs = new Map();
let sel = -1;
let rects = [];
let allPhotos = [];
let saveTimer = 0;
let hooks = { onSaved: () => {}, onExit: () => {} };

const canvas = () => $('#canvas');

/* ---------------- lifecycle ---------------- */

export function initEditor(h) {
  hooks = { ...hooks, ...h };
  buildLayoutPicker();
  wireCanvas();
  wireControls();
}

export async function openFrame(year, month, idx = 0) {
  const id = `${year}-${String(month).padStart(2, '0')}-${idx}`;
  frame = (await db.get('frames', id)) || newFrame(year, month, idx);
  syncCells(frame);
  sel = -1;
  imgs = await bitmapsFor(frame);
  allPhotos = await db.all('photos');
  allPhotos.sort((a, b) => a.takenAt - b.takenAt);
  syncControls();
  buildTray();
  draw();
  $('#ed-title').textContent = `${frame.year}年 ${MONTHS[frame.month - 1]}`;
}

export function currentFrame() { return frame; }

/* ---------------- drawing ---------------- */

function draw() {
  if (!frame) return;
  const c = canvas();
  const size = frameSizePx(frame, 1);
  if (c.width !== size.w || c.height !== size.h) { c.width = size.w; c.height = size.h; }
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  rects = renderFrame(ctx, frame, imgs, size.w, size.h, { selected: sel });
  $('#cellbar').hidden = sel < 0;
  if (sel >= 0) $('#cell-zoom').value = Math.round((frame.cells[sel].zoom || 1) * 100);
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 350);
}

async function save() {
  if (!frame) return;
  frame.updatedAt = Date.now();
  frame.hasContent = frame.cells.some((c) => c.photoId);
  const size = frameSizePx(frame, 1);
  const tw = frame.orient === 'landscape' ? THUMB_W : Math.round((THUMB_W * size.w) / size.h);
  const th = Math.round((tw * size.h) / size.w);
  frame.thumb = await canvasToBlob(renderToCanvas(frame, imgs, tw, th), 'image/jpeg', 0.8);
  await db.put('frames', frame);
  hooks.onSaved(frame);
}

export async function flushSave() { clearTimeout(saveTimer); await save(); }

/* ---------------- canvas interaction ---------------- */

function toCanvasPt(ev) {
  const c = canvas();
  const b = c.getBoundingClientRect();
  return { x: ((ev.clientX - b.left) / b.width) * c.width, y: ((ev.clientY - b.top) / b.height) * c.height };
}

function hit(pt) {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) return i;
  }
  return -1;
}

/** Keep the photo covering its cell: no blank edges after panning. */
function clampCell(i) {
  const cell = frame.cells[i];
  const img = cell.photoId && imgs.get(cell.photoId);
  const r = rects[i];
  if (!img || !r) return;
  cell.zoom = Math.min(6, Math.max(1, cell.zoom || 1));
  const s = coverScale(img.width, img.height, r.w, r.h, cell.rot || 0) * cell.zoom;
  const a = ((cell.rot || 0) * Math.PI) / 180;
  const co = Math.abs(Math.cos(a)); const si = Math.abs(Math.sin(a));
  const effW = img.width * s * co + img.height * s * si;
  const effH = img.width * s * si + img.height * s * co;
  const mx = Math.max(0, (effW - r.w) / 2) / r.w;
  const my = Math.max(0, (effH - r.h) / 2) / r.h;
  cell.ox = Math.min(mx, Math.max(-mx, cell.ox || 0));
  cell.oy = Math.min(my, Math.max(-my, cell.oy || 0));
}

function wireCanvas() {
  const c = canvas();
  const pts = new Map();
  let base = null;

  const dist = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const mid = () => {
    const [a, b] = [...pts.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId);
    const p = toCanvasPt(e);
    pts.set(e.pointerId, p);
    if (pts.size === 1) {
      const i = hit(p);
      if (i !== sel) { sel = i; draw(); }
      base = { last: p, zoom: sel >= 0 ? frame.cells[sel].zoom || 1 : 1 };
    } else if (pts.size === 2 && sel >= 0) {
      base = { d: dist(), zoom: frame.cells[sel].zoom || 1, last: mid() };
    }
  });

  c.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || sel < 0 || !base) return;
    const p = toCanvasPt(e);
    pts.set(e.pointerId, p);
    const cell = frame.cells[sel];
    if (!cell.photoId) return;
    const r = rects[sel];

    if (pts.size >= 2) {
      const d = dist();
      if (base.d > 0) cell.zoom = Math.min(6, Math.max(1, base.zoom * (d / base.d)));
      const m = mid();
      cell.ox = (cell.ox || 0) + (m.x - base.last.x) / r.w;
      cell.oy = (cell.oy || 0) + (m.y - base.last.y) / r.h;
      base.last = m;
    } else {
      cell.ox = (cell.ox || 0) + (p.x - base.last.x) / r.w;
      cell.oy = (cell.oy || 0) + (p.y - base.last.y) / r.h;
      base.last = p;
    }
    clampCell(sel);
    draw();
    queueSave();
  });

  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size === 1) base = { last: [...pts.values()][0], zoom: sel >= 0 ? frame.cells[sel].zoom || 1 : 1 };
    if (pts.size === 0) base = null;
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);

  c.addEventListener('wheel', (e) => {
    if (sel < 0 || !frame.cells[sel].photoId) return;
    e.preventDefault();
    const cell = frame.cells[sel];
    cell.zoom = Math.min(6, Math.max(1, (cell.zoom || 1) * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    clampCell(sel);
    draw();
    queueSave();
  }, { passive: false });

  c.addEventListener('dblclick', () => {
    if (sel < 0) return;
    Object.assign(frame.cells[sel], { zoom: 1, ox: 0, oy: 0 });
    draw(); queueSave();
  });
}

/* ---------------- tray ---------------- */

function trayPhotos() {
  if ($('#tray-thismonth').checked) {
    return allPhotos.filter((p) => p.year === frame.year && p.month === frame.month);
  }
  return allPhotos.slice().reverse();
}

function buildTray() {
  const box = $('#tray');
  box.textContent = '';
  const list = trayPhotos();
  if (!list.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = $('#tray-thismonth').checked
      ? 'この月の写真がありません。「この月だけ」を外すか、写真を追加してください。'
      : '写真がありません。「＋ 写真を追加」から取り込んでください。';
    box.appendChild(d);
    return;
  }
  const used = new Set(frame.cells.map((c) => c.photoId).filter(Boolean));
  for (const p of list) {
    const b = document.createElement('button');
    b.className = 'ph' + (used.has(p.id) ? ' used' : '');
    b.title = new Date(p.takenAt).toLocaleDateString('ja-JP');
    const im = document.createElement('img');
    im.src = thumbURL(p);
    im.loading = 'lazy';
    im.alt = p.name;
    b.appendChild(im);
    b.addEventListener('click', () => place(p.id));
    box.appendChild(b);
  }
}

async function place(photoId) {
  let i = sel;
  if (i < 0) i = frame.cells.findIndex((c) => !c.photoId);
  if (i < 0) i = 0;
  const bm = await bitmap(photoId);
  if (bm) imgs.set(photoId, bm);
  frame.cells[i] = { ...newCell(), photoId };
  sel = i;
  draw();
  clampCell(i);
  draw();
  buildTray();
  queueSave();
}

async function autofill() {
  const used = new Set(frame.cells.map((c) => c.photoId).filter(Boolean));
  const pool = trayPhotos().filter((p) => !used.has(p.id));
  let n = 0;
  for (let i = 0; i < frame.cells.length && n < pool.length; i++) {
    if (frame.cells[i].photoId) continue;
    const p = pool[n++];
    const bm = await bitmap(p.id);
    if (bm) imgs.set(p.id, bm);
    frame.cells[i] = { ...newCell(), photoId: p.id };
  }
  draw();
  frame.cells.forEach((_, i) => clampCell(i));
  draw();
  buildTray();
  queueSave();
  toast(n ? `${n}枚 配置しました` : '配置できる写真がありません');
}

/* ---------------- layout picker ---------------- */

function buildLayoutPicker() {
  const box = $('#layouts');
  box.textContent = '';
  for (const L of LAYOUTS) {
    const b = document.createElement('button');
    b.className = 'ly';
    b.dataset.ly = L.id;
    b.title = L.name;
    b.innerHTML = layoutSVG(L.id) + `<small>${L.count}</small>`;
    b.addEventListener('click', () => {
      frame.layout = L.id;
      syncCells(frame);
      if (sel >= frame.cells.length) sel = -1;
      syncControls();
      draw();
      frame.cells.forEach((_, i) => clampCell(i));
      draw();
      queueSave();
    });
    box.appendChild(b);
  }
}

function layoutSVG(id) {
  const W = 30, H = 40;
  const rs = cellRects({ layout: id, split: 0.5, gapPct: 3, padPct: 0 }, W, H);
  const body = rs.map((r) => `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" rx="1.5" fill="currentColor" opacity=".35"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${body}</svg>`;
}

/* ---------------- controls ---------------- */

function syncControls() {
  $$('#layouts .ly').forEach((b) => b.classList.toggle('on', b.dataset.ly === frame.layout));
  $$('#orient button').forEach((b) => b.classList.toggle('on', b.dataset.v === frame.orient));
  $$('#stamp button').forEach((b) => b.classList.toggle('on', b.dataset.v === (frame.stamp.show ? frame.stamp.style : 'none')));
  $('#split-wrap').hidden = !layoutHasSplit(frame.layout);
  $('#ly-split').value = Math.round(frame.split * 100);
  $('#ly-gap').value = frame.gapPct;
  $('#ly-pad').value = frame.padPct;
  $('#ly-bg').value = frame.bg;
  $('#cap-show').checked = frame.caption.show;
  $('#cap-text').value = frame.caption.text;
  $('#cap-size').value = frame.caption.sizePct;
  $('#cap-color').value = frame.caption.color;
  $('#lb-title').value = frame.label.title;
  $('#lb-note').value = frame.label.note;
  $('#out-printed').checked = !!frame.printed;
}

function on(selq, ev, fn) { const el = $(selq); if (el) el.addEventListener(ev, fn); }

function wireControls() {
  $$('#tabs .tab').forEach((t) => t.addEventListener('click', () => {
    $$('#tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.editor .panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === t.dataset.tab));
  }));

  on('#tray-thismonth', 'change', buildTray);
  on('#ed-autofill', 'click', autofill);
  on('#ed-add', 'click', () => pickFiles());

  $$('#orient button').forEach((b) => b.addEventListener('click', () => {
    frame.orient = b.dataset.v; syncControls(); draw();
    frame.cells.forEach((_, i) => clampCell(i)); draw(); queueSave();
  }));
  $$('#stamp button').forEach((b) => b.addEventListener('click', () => {
    frame.stamp = { show: b.dataset.v !== 'none', style: b.dataset.v === 'none' ? 'corner' : b.dataset.v };
    syncControls(); draw(); queueSave();
  }));

  const live = (id, fn) => on(id, 'input', (e) => { fn(e.target.value); draw(); queueSave(); });
  live('#ly-split', (v) => { frame.split = +v / 100; frame.cells.forEach((_, i) => clampCell(i)); });
  live('#ly-gap', (v) => { frame.gapPct = +v; });
  live('#ly-pad', (v) => { frame.padPct = +v; });
  live('#ly-bg', (v) => { frame.bg = v; });
  live('#cap-text', (v) => { frame.caption.text = v; });
  live('#cap-size', (v) => { frame.caption.sizePct = +v; });
  live('#cap-color', (v) => { frame.caption.color = v; });
  on('#cap-show', 'change', (e) => { frame.caption.show = e.target.checked; draw(); queueSave(); });
  on('#lb-title', 'input', (e) => { frame.label.title = e.target.value; queueSave(); });
  on('#lb-note', 'input', (e) => { frame.label.note = e.target.value; queueSave(); });
  on('#out-printed', 'change', (e) => { frame.printed = e.target.checked; queueSave(); });

  $$('[data-bg]').forEach((b) => b.addEventListener('click', () => {
    frame.bg = b.dataset.bg; $('#ly-bg').value = frame.bg; draw(); queueSave();
  }));

  on('#cell-zoom', 'input', (e) => {
    if (sel < 0) return;
    frame.cells[sel].zoom = +e.target.value / 100;
    clampCell(sel); draw(); queueSave();
  });

  $$('#cellbar [data-act]').forEach((b) => b.addEventListener('click', () => {
    if (sel < 0) return;
    const c = frame.cells[sel];
    const act = b.dataset.act;
    if (act === 'zoom-in') c.zoom = Math.min(6, (c.zoom || 1) * 1.15);
    if (act === 'zoom-out') c.zoom = Math.max(1, (c.zoom || 1) / 1.15);
    if (act === 'rot-l') c.rot = ((c.rot || 0) - 90 + 360) % 360;
    if (act === 'rot-r') c.rot = ((c.rot || 0) + 90) % 360;
    if (act === 'fit') Object.assign(c, { zoom: 1, ox: 0, oy: 0, rot: 0 });
    if (act === 'clear') { frame.cells[sel] = newCell(); buildTray(); }
    clampCell(sel); draw(); queueSave();
  }));

  on('#ed-prev', 'click', () => step(-1));
  on('#ed-next', 'click', () => step(1));
  on('#ed-delete', 'click', async () => {
    if (!confirm(`${frame.year}年${frame.month}月 のコマを削除しますか？（写真自体は残ります）`)) return;
    clearTimeout(saveTimer);
    await db.del('frames', frame.id);
    hooks.onSaved(null);
    hooks.onExit();
  });
}

async function step(d) {
  await flushSave();
  let y = frame.year, m = frame.month + d;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  await openFrame(y, m, 0);
}

/** Import photos into the library, then refresh the tray. */
export async function pickFiles() {
  const input = $('#file-input');
  input.value = '';
  input.click();
  await new Promise((res) => {
    input.onchange = res;
    input.oncancel = res;
  });
  const files = [...(input.files || [])];
  if (!files.length) return [];
  busy(`取り込み中… 0/${files.length}`);
  const added = await importFiles(files, (i, n) => busy(`取り込み中… ${i}/${n}`));
  busy(false);
  allPhotos = await db.all('photos');
  allPhotos.sort((a, b) => a.takenAt - b.takenAt);
  if (frame) buildTray();
  toast(`${added.length}枚 取り込みました`);
  return added;
}

export function redraw() { draw(); }
