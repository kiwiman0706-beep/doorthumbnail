// Photo import: EXIF date sniffing, downscaling, thumbnails and a decoded-bitmap cache.

import { db, uid } from './db.js';

const WORK_MAX = 2048;   // longest edge kept for editing/printing
const THUMB_MAX = 320;

const bitmaps = new Map();   // photoId -> ImageBitmap
const pending = new Map();   // photoId -> Promise

/** Minimal EXIF reader: returns DateTimeOriginal as a Date, or null. */
export async function exifDate(file) {
  try {
    const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (buf.byteLength < 4 || buf.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < buf.byteLength) {
      if (buf.getUint8(off) !== 0xff) break;
      const marker = buf.getUint8(off + 1);
      const size = buf.getUint16(off + 2);
      if (marker === 0xe1 && buf.getUint32(off + 4) === 0x45786966) {
        return readTiff(buf, off + 10);
      }
      if (marker === 0xda) break;
      off += 2 + size;
    }
  } catch { /* not a JPEG, or truncated — fall back to the file date */ }
  return null;
}

function readTiff(buf, base) {
  const le = buf.getUint16(base) === 0x4949;
  const u16 = (p) => buf.getUint16(p, le);
  const u32 = (p) => buf.getUint32(p, le);
  if (u16(base + 2) !== 0x002a) return null;

  const readAscii = (p, n) => {
    let s = '';
    for (let i = 0; i < n - 1; i++) s += String.fromCharCode(buf.getUint8(p + i));
    return s;
  };
  const scan = (ifd, tag) => {
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === tag) {
        const count = u32(e + 4);
        const valOff = count > 4 ? base + u32(e + 8) : e + 8;
        return { count, valOff };
      }
    }
    return null;
  };

  const ifd0 = base + u32(base + 4);
  let hit = scan(ifd0, 0x9003) || scan(ifd0, 0x0132);
  const ptr = scan(ifd0, 0x8769);
  if (ptr) {
    const exifIfd = base + u32(ptr.valOff);
    hit = scan(exifIfd, 0x9003) || scan(exifIfd, 0x9004) || hit;
  }
  if (!hit) return null;
  const s = readAscii(hit.valOff, hit.count);           // "YYYY:MM:DD HH:MM:SS"
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { /* Safari < 16 ignores the option; fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function fit(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

function toCanvas(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

function blobOf(canvas, q = 0.9) {
  return new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));
}

/** Import one file; returns the stored photo record. */
export async function importFile(file) {
  const src = await decode(file);
  const sw = src.width, sh = src.height;
  const work = fit(sw, sh, WORK_MAX);
  const thumb = fit(sw, sh, THUMB_MAX);

  const workBlob = (work.w === sw && work.h === sh && file.type === 'image/jpeg')
    ? file
    : await blobOf(toCanvas(src, work.w, work.h), 0.92);
  const thumbBlob = await blobOf(toCanvas(src, thumb.w, thumb.h), 0.75);

  const taken = (await exifDate(file)) || (file.lastModified ? new Date(file.lastModified) : new Date());
  const rec = {
    id: uid('ph'),
    name: file.name || 'photo.jpg',
    w: work.w, h: work.h,
    blob: workBlob,
    thumb: thumbBlob,
    takenAt: taken.getTime(),
    year: taken.getFullYear(),
    month: taken.getMonth() + 1,
    addedAt: Date.now(),
  };
  await db.put('photos', rec);
  if (src.close) src.close();
  return rec;
}

export async function importFiles(files, onProgress) {
  const out = [];
  let i = 0;
  for (const f of files) {
    if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || '')) continue;
    try { out.push(await importFile(f)); }
    catch (e) { console.warn('import failed', f.name, e); }
    if (onProgress) onProgress(++i, files.length);
  }
  return out;
}

/** Decoded bitmap for a photo id, cached. */
export function bitmap(photoId) {
  if (bitmaps.has(photoId)) return Promise.resolve(bitmaps.get(photoId));
  if (pending.has(photoId)) return pending.get(photoId);
  const p = (async () => {
    const rec = await db.get('photos', photoId);
    if (!rec) return null;
    const bm = await decode(rec.blob);
    bitmaps.set(photoId, bm);
    pending.delete(photoId);
    return bm;
  })();
  pending.set(photoId, p);
  return p;
}

/** Load every bitmap a frame needs into a Map for the renderer. */
export async function bitmapsFor(frame) {
  const ids = [...new Set(frame.cells.map((c) => c.photoId).filter(Boolean))];
  const map = new Map();
  await Promise.all(ids.map(async (id) => {
    const bm = await bitmap(id);
    if (bm) map.set(id, bm);
  }));
  return map;
}

export function forgetBitmap(photoId) {
  const bm = bitmaps.get(photoId);
  if (bm && bm.close) bm.close();
  bitmaps.delete(photoId);
}

const urlCache = new Map();
export function thumbURL(rec) {
  if (!urlCache.has(rec.id)) urlCache.set(rec.id, URL.createObjectURL(rec.thumb || rec.blob));
  return urlCache.get(rec.id);
}
export function releaseThumb(id) {
  const u = urlCache.get(id);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(id); }
}
