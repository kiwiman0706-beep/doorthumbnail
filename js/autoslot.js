// Drops freshly imported photos straight into the year/month cell they belong to.
// This is what removes most of the manual work: import a month's photos, get a collage.

import { db } from './db.js';
import { bitmapsFor } from './photos.js';
import { newFrame, syncCells, layoutCount, frameSizePx, frameId } from './model.js';
import { renderToCanvas, canvasToBlob } from './render.js';

export function layoutFor(n) {
  if (n <= 1) return '1';
  if (n === 2) return '2v';
  if (n === 3) return '3t';
  if (n === 4) return '4';
  if (n <= 6) return '6';
  if (n <= 8) return '8';
  return '9';
}

export async function saveWithThumb(frame) {
  const imgs = await bitmapsFor(frame);
  frame.hasContent = frame.cells.some((c) => c.photoId);
  frame.updatedAt = Date.now();
  const size = frameSizePx(frame, 1);
  const tw = frame.orient === 'landscape' ? 180 : Math.round((180 * size.w) / size.h);
  const th = Math.round((tw * size.h) / size.w);
  frame.thumb = await canvasToBlob(renderToCanvas(frame, imgs, tw, th), 'image/jpeg', 0.8);
  await db.put('frames', frame);
  return frame;
}

/**
 * @param {Array} photos freshly imported photo records
 * @param {(year:number)=>Promise<any>} [onYear] called once per touched year
 * @returns {Promise<{placed:number, skipped:number, years:number[]}>}
 */
export async function autoSlot(photos, onYear) {
  const groups = new Map();
  for (const p of photos) {
    const k = `${p.year}-${p.month}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  let placed = 0, skipped = 0;
  const years = new Set();

  for (const [, list] of groups) {
    list.sort((a, b) => a.takenAt - b.takenAt);
    const { year, month } = list[0];
    const id = frameId(year, month, 0);
    let frame = await db.get('frames', id);
    const fresh = !frame;
    if (fresh) frame = newFrame(year, month, 0);

    if (fresh) {
      frame.layout = layoutFor(list.length);
      syncCells(frame);
    } else {
      // Grow the layout so the new photos fit alongside what is already there.
      const free = frame.cells.filter((c) => !c.photoId).length;
      if (free < list.length) {
        const want = frame.cells.filter((c) => c.photoId).length + list.length;
        const grown = layoutFor(want);
        if (layoutCount(grown) > frame.cells.length) { frame.layout = grown; syncCells(frame); }
      }
    }

    let n = 0;
    for (let i = 0; i < frame.cells.length && n < list.length; i++) {
      if (frame.cells[i].photoId) continue;
      frame.cells[i] = { photoId: list[n++].id, zoom: 1, ox: 0, oy: 0, rot: 0 };
      placed++;
    }
    skipped += list.length - n;

    await saveWithThumb(frame);
    years.add(year);
    if (onYear) await onYear(year);
  }
  return { placed, skipped, years: [...years] };
}
