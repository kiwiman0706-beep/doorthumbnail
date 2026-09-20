// Frame data model + collage layout templates.

import { uid } from './db.js';

// instax mini: card 54 x 86 mm, printed image area 46 x 62 mm.
// instax mini Link prints 600 x 800 dots over that image area (~12.5 dots/mm).
export const INSTAX = {
  card: { w: 54, h: 86 },          // mm, portrait
  image: { w: 46, h: 62 },         // mm, portrait
  px: { w: 600, h: 800 },          // instax mini Link native, portrait
};

export const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

// Each template returns normalised rects {x,y,w,h} inside the content box.
// `s` is the divider position (0.2 - 0.8) for templates that support it.
const T = {
  '1':  { name: '1枚',          split: false, f: () => [[0,0,1,1]] },
  '2v': { name: '上下 2枚',     split: true,  f: (s) => [[0,0,1,s],[0,s,1,1-s]] },
  '2h': { name: '左右 2枚',     split: true,  f: (s) => [[0,0,s,1],[s,0,1-s,1]] },
  '3v': { name: '縦 3枚',       split: false, f: () => [[0,0,1,1/3],[0,1/3,1,1/3],[0,2/3,1,1/3]] },
  '3t': { name: '上1 + 下2',    split: true,  f: (s) => [[0,0,1,s],[0,s,.5,1-s],[.5,s,.5,1-s]] },
  '3b': { name: '上2 + 下1',    split: true,  f: (s) => [[0,0,.5,s],[.5,0,.5,s],[0,s,1,1-s]] },
  '3l': { name: '左1 + 右2',    split: true,  f: (s) => [[0,0,s,1],[s,0,1-s,.5],[s,.5,1-s,.5]] },
  '4':  { name: '2×2',          split: false, f: () => [[0,0,.5,.5],[.5,0,.5,.5],[0,.5,.5,.5],[.5,.5,.5,.5]] },
  '4t': { name: '上1大 + 下3',  split: true,  f: (s) => [[0,0,1,s],[0,s,1/3,1-s],[1/3,s,1/3,1-s],[2/3,s,1/3,1-s]] },
  '6':  { name: '2×3',          split: false, f: () => grid(2,3) },
  '8':  { name: '2×4',          split: false, f: () => grid(2,4) },
  '9':  { name: '3×3',          split: false, f: () => grid(3,3) },
};

function grid(cols, rows) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([c/cols, r/rows, 1/cols, 1/rows]);
  return out;
}

export const LAYOUTS = Object.entries(T).map(([id, v]) => ({ id, name: v.name, split: v.split, count: v.f(0.5).length }));

export function layoutHasSplit(id) { return !!(T[id] && T[id].split); }
export function layoutCount(id) { return (T[id] || T['1']).f(0.5).length; }

/** Pixel rects for a layout, with outer padding and inter-cell gap applied. */
export function layoutRects(layoutId, split, W, H, padPx, gapPx) {
  const t = T[layoutId] || T['1'];
  const s = Math.min(0.8, Math.max(0.2, split ?? 0.5));
  const cw = W - padPx * 2;
  const ch = H - padPx * 2;
  const g = gapPx / 2;
  return t.f(s).map(([x, y, w, h]) => {
    // Shrink each rect by half a gap on the sides that touch a neighbour.
    const l = padPx + x * cw + (x > 0.0001 ? g : 0);
    const tp = padPx + y * ch + (y > 0.0001 ? g : 0);
    const r = padPx + (x + w) * cw - (x + w < 0.9999 ? g : 0);
    const b = padPx + (y + h) * ch - (y + h < 0.9999 ? g : 0);
    return { x: l, y: tp, w: Math.max(1, r - l), h: Math.max(1, b - tp) };
  });
}

export function newCell() {
  return { photoId: null, zoom: 1, ox: 0, oy: 0, rot: 0 };
}

export function newFrame(year, month, idx = 0) {
  return {
    id: frameId(year, month, idx),
    year, month, idx,
    orient: 'portrait',
    layout: '1',
    split: 0.5,
    bg: '#ffffff',
    gapPct: 1.5,      // % of the short side
    padPct: 0,        // % of the short side
    cells: [newCell()],
    caption: { show: false, text: '', sizePct: 7, color: '#ffffff', shadow: true, align: 'center' },
    stamp: { show: true, style: 'corner' }, // the "2026.09" burned into the image
    label: { title: '', note: '' },         // text destined for the TEPRA label
    printed: false,
    updatedAt: Date.now(),
  };
}

export function frameId(year, month, idx = 0) {
  return `${year}-${String(month).padStart(2, '0')}-${idx}`;
}

/** Resize `cells` so it matches the cell count of the current layout, keeping existing photos. */
export function syncCells(frame) {
  const n = layoutCount(frame.layout);
  while (frame.cells.length < n) frame.cells.push(newCell());
  if (frame.cells.length > n) frame.cells.length = n;
  return frame;
}

export function frameSizePx(frame, scale = 1) {
  const p = INSTAX.px;
  return frame.orient === 'landscape'
    ? { w: Math.round(p.h * scale), h: Math.round(p.w * scale) }
    : { w: Math.round(p.w * scale), h: Math.round(p.h * scale) };
}

export function frameSizeMm(frame, area = 'image') {
  const m = INSTAX[area];
  return frame.orient === 'landscape' ? { w: m.h, h: m.w } : { w: m.w, h: m.h };
}

export function ymLabel(year, month) {
  return `${year}.${String(month).padStart(2, '0')}`;
}

export function uidPhoto() { return uid('ph'); }
