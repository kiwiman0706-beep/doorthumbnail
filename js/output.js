// Inkjet contact sheet (A4) + TEPRA label list.

import { db } from './db.js';
import { bitmapsFor, } from './photos.js';
import { INSTAX, ymLabel } from './model.js';
import { renderToCanvas } from './render.js';
import { $, $$, toast, busy, download, copyText, shareText } from './ui.js';

const MAX_TILES = 240;
const PX_PER_MM = 96 / 25.4;

let sheetSize = 'image';
let built = [];

export function initOutput() {
  $$('#otabs .tab').forEach((t) => t.addEventListener('click', () => {
    $$('#otabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('#view-output .panel').forEach((p) => p.classList.toggle('active', p.dataset.opanel === t.dataset.otab));
  }));
  $$('#sh-size button').forEach((b) => b.addEventListener('click', () => {
    sheetSize = b.dataset.v;
    $$('#sh-size button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  const syncYear = (sel, inp) => {
    const f = () => { $(inp).hidden = $(sel).value !== 'year'; };
    $(sel).addEventListener('change', f); f();
  };
  syncYear('#sh-scope', '#sh-year');
  syncYear('#lb-scope', '#lb-year');
  $('#sh-build').addEventListener('click', buildSheet);
  $('#sh-print').addEventListener('click', () => window.print());
  $('#lb-build').addEventListener('click', buildLabels);
  $('#lb-csv').addEventListener('click', downloadCsv);
  $('#lb-copy').addEventListener('click', async () => {
    const ok = await copyText($('#lb-out').value);
    toast(ok ? 'コピーしました' : 'コピーできませんでした');
    if (ok) markLabeled();
  });
  $('#lb-share').addEventListener('click', async () => {
    const ok = await shareText($('#lb-out').value, 'テプラ用ラベル');
    if (ok) markLabeled(); else toast('共有に対応していません');
  });

  const y = new Date().getFullYear();
  $('#sh-year').value = y;
  $('#lb-year').value = y;
  window.addEventListener('resize', fitPreview);
}

async function pickFrames(scope, year) {
  const all = (await db.all('frames')).filter((f) => f.hasContent);
  all.sort((a, b) => a.year - b.year || a.month - b.month || a.idx - b.idx);
  if (scope === 'year') return all.filter((f) => f.year === year);
  if (scope === 'unprinted') return all.filter((f) => !f.printed);
  if (scope === 'unlabeled') return all.filter((f) => !f.labeled);
  return all;
}

/* ---------------- inkjet sheet ---------------- */

function tileMm(frame) {
  const land = frame.orient === 'landscape';
  if (sheetSize === 'image') {
    return land
      ? { w: INSTAX.image.h, h: INSTAX.image.w }
      : { w: INSTAX.image.w, h: INSTAX.image.h };
  }
  return land
    ? { w: INSTAX.card.h, h: INSTAX.card.w }
    : { w: INSTAX.card.w, h: INSTAX.card.h };
}

function tileEl(frame, dataUrl, opts) {
  const mm = tileMm(frame);
  const el = document.createElement('div');
  el.className = 'tile' + (opts.marks ? ' marks' : '') + (sheetSize === 'card' ? ' card' : '');
  el.style.width = `${mm.w}mm`;
  el.style.height = `${mm.h}mm`;

  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = '';

  if (sheetSize === 'image') {
    el.appendChild(img);
    return el;
  }

  // Full instax card: real image position, with the wide white margin left for text.
  const land = frame.orient === 'landscape';
  const iw = land ? INSTAX.image.h : INSTAX.image.w;
  const ih = land ? INSTAX.image.w : INSTAX.image.h;
  const box = document.createElement('div');
  box.className = 'imgbox';
  box.style.width = `${iw}mm`;
  box.style.height = `${ih}mm`;
  box.appendChild(img);

  const foot = document.createElement('div');
  foot.className = 'foot';
  if (opts.captions) {
    const t = document.createElement('div');
    t.textContent = `${ymLabel(frame.year, frame.month)}　${frame.label.title || ''}`.trim();
    foot.appendChild(t);
    if (frame.label.note) {
      const n = document.createElement('div');
      n.className = 'n';
      n.textContent = frame.label.note;
      foot.appendChild(n);
    }
  }

  if (land) {
    el.style.flexDirection = 'row';
    box.style.margin = '4mm 0 4mm 4mm';
    foot.style.width = `${mm.w - iw - 4}mm`;
  } else {
    box.style.margin = '5mm 4mm 0';
  }
  el.appendChild(box);
  el.appendChild(foot);
  return el;
}

async function buildSheet() {
  const scope = $('#sh-scope').value;
  const year = parseInt($('#sh-year').value, 10);
  const marks = $('#sh-marks').checked;
  const captions = $('#sh-cap').checked;
  const list = await pickFrames(scope, year);

  const host = $('#sheet');
  host.textContent = '';
  built = [];
  if (!list.length) { $('#sh-count').textContent = '対象のコマがありません'; $('#sh-print').disabled = true; return; }
  if (list.length > MAX_TILES) {
    toast(`多すぎるため先頭 ${MAX_TILES} コマだけ作ります`);
    list.length = MAX_TILES;
  }

  busy(`シート作成中… 0/${list.length}`);
  const scroll = document.createElement('div');
  scroll.className = 'sheet-scroll';
  host.appendChild(scroll);

  // A4 content box with the 8mm @page margin applied.
  const availW = 210 - 16;
  const availH = 297 - 16;
  const gap = 3;
  let page = null, rowW = 0, colH = 0, rowH = 0;

  const newPage = () => {
    page = document.createElement('div');
    page.className = 'page';
    scroll.appendChild(page);
    rowW = 0; colH = 0; rowH = 0;
  };
  newPage();

  for (let i = 0; i < list.length; i++) {
    const frame = list[i];
    const imgs = await bitmapsFor(frame);
    const c = renderToCanvas(frame, imgs, ...sizeOf(frame));
    const url = c.toDataURL('image/jpeg', 0.9);
    const mm = tileMm(frame);

    if (rowW > 0 && rowW + gap + mm.w > availW) { colH += rowH + gap; rowW = 0; rowH = 0; }
    if (colH + mm.h > availH) { newPage(); }
    page.appendChild(tileEl(frame, url, { marks, captions }));
    rowW += (rowW ? gap : 0) + mm.w;
    rowH = Math.max(rowH, mm.h);

    built.push(frame.id);
    busy(`シート作成中… ${i + 1}/${list.length}`);
    if (i % 4 === 3) await new Promise((r) => setTimeout(r));
  }
  busy(false);

  const pages = scroll.querySelectorAll('.page').length;
  $('#sh-count').textContent = `${list.length} コマ / ${pages} ページ`;
  $('#sh-print').disabled = false;
  fitPreview();
}

function sizeOf(frame) {
  const p = INSTAX.px;
  return frame.orient === 'landscape' ? [p.h, p.w] : [p.w, p.h];
}

function fitPreview() {
  const scroll = $('#sheet .sheet-scroll');
  if (!scroll) return;
  const pageW = 210 * PX_PER_MM;
  const k = Math.min(1, (scroll.clientWidth - 4) / pageW);
  $$('#sheet .page').forEach((p) => {
    p.style.transform = k < 1 ? `scale(${k})` : '';
    p.style.marginBottom = k < 1 ? `${12 - 297 * PX_PER_MM * (1 - k)}px` : '12px';
  });
}

/** Called from the app once the user has actually printed. */
export async function markPrinted() {
  if (!built.length) return 0;
  const frames = await db.all('frames');
  const set = new Set(built);
  const upd = frames.filter((f) => set.has(f.id)).map((f) => ({ ...f, printed: true }));
  await db.putMany('frames', upd);
  return upd.length;
}

/* ---------------- TEPRA labels ---------------- */

let labelRows = [];

function labelLines(frame, format) {
  const ym = ymLabel(frame.year, frame.month);
  const title = (frame.label.title || frame.caption.text || '').replace(/\n/g, ' ').trim();
  const note = (frame.label.note || '').replace(/\n/g, ' ').trim();
  if (format === 'ym') return [ym, ''];
  if (format === '1line') return [[ym, title, note].filter(Boolean).join(' '), ''];
  return [[ym, title].filter(Boolean).join('　'), note];
}

async function buildLabels() {
  const scope = $('#lb-scope').value;
  const year = parseInt($('#lb-year').value, 10);
  const format = $('#lb-format').value;
  const list = await pickFrames(scope, year);
  if (!list.length) { $('#lb-out').value = ''; toast('対象のコマがありません'); return; }

  labelRows = list.map((f) => {
    const [l1, l2] = labelLines(f, format);
    return { id: f.id, year: f.year, month: f.month, ym: ymLabel(f.year, f.month), l1, l2 };
  });
  $('#lb-out').value = labelRows.map((r) => (r.l2 ? `${r.l1}\t${r.l2}` : r.l1)).join('\n');
  $('#lb-csv').disabled = false;
  $('#lb-copy').disabled = false;
  $('#lb-share').disabled = !navigator.share;
  toast(`${labelRows.length} 件 作成しました`);
}

function csvCell(s) { return `"${String(s ?? '').replace(/"/g, '""')}"`; }

function downloadCsv() {
  if (!labelRows.length) return;
  const head = ['年', '月', '年月', '1行目', '2行目'];
  const body = labelRows.map((r) => [r.year, r.month, r.ym, r.l1, r.l2].map(csvCell).join(','));
  const csv = '﻿' + [head.map(csvCell).join(','), ...body].join('\r\n') + '\r\n';
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `tepra-labels-${Date.now()}.csv`);
  markLabeled();
}

async function markLabeled() {
  if (!labelRows.length) return;
  const frames = await db.all('frames');
  const set = new Set(labelRows.map((r) => r.id));
  await db.putMany('frames', frames.filter((f) => set.has(f.id)).map((f) => ({ ...f, labeled: true })));
}
