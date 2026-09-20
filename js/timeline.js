// Year (rows) x Month (columns) grid — the on-screen twin of the fridge door.

import { db } from './db.js';
import { MONTHS } from './model.js';
import { $, $$, toast } from './ui.js';

let frames = new Map();     // "YYYY-MM-0" -> frame
let counts = new Map();     // "YYYY-M" -> photos in the library for that month
let urls = new Map();       // frame id -> object URL for its thumbnail
let onOpen = () => {};
let range = { from: 2016, to: new Date().getFullYear() };

export function initTimeline(h) {
  onOpen = h.onOpen;
  $$('#zoomlv button').forEach((b) => b.addEventListener('click', async () => {
    setZoom(b.dataset.v);
    await db.setting('zoom', b.dataset.v);
  }));
  $('#year-from').addEventListener('change', async (e) => {
    range.from = clampYear(e.target.value, range.from);
    if (range.from > range.to) range.to = range.from;
    await saveRange(); await refresh();
  });
  $('#year-to').addEventListener('change', async (e) => {
    range.to = clampYear(e.target.value, range.to);
    if (range.to < range.from) range.from = range.to;
    await saveRange(); await refresh();
  });
}

function clampYear(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1900 && n <= 2999 ? n : fallback;
}

async function saveRange() { await db.setting('range', range); }

function setZoom(v) {
  document.body.classList.toggle('compact', v === 'compact');
  $$('#zoomlv button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
}

export async function loadRange() {
  const saved = await db.setting('range');
  if (saved) range = saved;
  setZoom((await db.setting('zoom')) || (window.innerWidth < 560 ? 'compact' : 'large'));
  const all = await db.all('frames');
  if (all.length) {
    range.from = Math.min(range.from, ...all.map((f) => f.year));
    range.to = Math.max(range.to, ...all.map((f) => f.year));
  }
  return range;
}

export async function refresh() {
  const [fr, ph] = await Promise.all([db.all('frames'), db.all('photos')]);
  frames = new Map(fr.map((f) => [f.id, f]));

  const used = new Set();
  fr.forEach((f) => f.cells.forEach((c) => c.photoId && used.add(c.photoId)));
  counts = new Map();
  for (const p of ph) {
    if (used.has(p.id)) continue;
    const k = `${p.year}-${p.month}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  $('#year-from').value = range.from;
  $('#year-to').value = range.to;
  build();

  const done = fr.filter((f) => f.hasContent).length;
  const printed = fr.filter((f) => f.printed).length;
  $('#stats').textContent = `作成 ${done} コマ ／ 印刷済み ${printed} ／ 写真 ${ph.length}枚（未配置 ${ph.length - used.size}）`;
}

function build() {
  const table = $('#grid');
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = new Map();
  table.textContent = '';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'yr';
  hr.appendChild(corner);
  MONTHS.forEach((m) => { const th = document.createElement('th'); th.textContent = m; hr.appendChild(th); });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const now = new Date();
  const nowKey = now.getFullYear() * 12 + now.getMonth() + 1;

  for (let y = range.from; y <= range.to; y++) {
    const tr = document.createElement('tr');
    const yd = document.createElement('td');
    yd.className = 'yr';
    yd.textContent = y;
    tr.appendChild(yd);

    for (let m = 1; m <= 12; m++) {
      const td = document.createElement('td');
      const id = `${y}-${String(m).padStart(2, '0')}-0`;
      const f = frames.get(id);
      const b = document.createElement('button');
      b.className = 'cell' + (f && f.orient === 'landscape' ? ' landscape' : '');
      b.setAttribute('aria-label', `${y}年${m}月`);

      if (f && f.thumb) {
        const u = URL.createObjectURL(f.thumb);
        urls.set(id, u);
        const im = document.createElement('img');
        im.src = u; im.loading = 'lazy'; im.alt = '';
        b.appendChild(im);
        if (f.printed) b.classList.add('printed');
      } else {
        b.classList.add('empty');
        const n = counts.get(`${y}-${m}`) || 0;
        if (n) { const s = document.createElement('span'); s.className = 'n'; s.textContent = n; b.appendChild(s); }
      }
      if (y * 12 + m > nowKey) b.classList.add('future');
      b.addEventListener('click', () => onOpen(y, m, 0));
      td.appendChild(b);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

export function getRange() { return { ...range }; }

export async function extendRangeTo(year) {
  let changed = false;
  if (year < range.from) { range.from = year; changed = true; }
  if (year > range.to) { range.to = year; changed = true; }
  if (changed) { await saveRange(); toast(`表示年を ${range.from}〜${range.to} に広げました`); }
  return changed;
}
