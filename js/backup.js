// Whole-library backup to a single JSON file (photos are embedded as data URLs).

import { db } from './db.js';
import { forgetBitmap, releaseThumb } from './photos.js';
import { busy, download, toast } from './ui.js';

const FORMAT = 'door-thumbnail-backup@1';

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(url) {
  const r = await fetch(url);
  return r.blob();
}

export async function exportBackup() {
  const [photos, frames, meta] = await Promise.all([db.all('photos'), db.all('frames'), db.all('meta')]);
  busy(`書き出し中… 0/${photos.length}`);

  // Assembled as Blob parts so we never hold one enormous string.
  const parts = [`{"format":"${FORMAT}","exportedAt":${Date.now()},"meta":${JSON.stringify(meta)},"photos":[`];
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const rec = {
      id: p.id, name: p.name, w: p.w, h: p.h,
      takenAt: p.takenAt, year: p.year, month: p.month, addedAt: p.addedAt,
      blob: await blobToDataUrl(p.blob),
      thumb: p.thumb ? await blobToDataUrl(p.thumb) : null,
    };
    parts.push((i ? ',' : '') + JSON.stringify(rec));
    if (i % 10 === 0) { busy(`書き出し中… ${i + 1}/${photos.length}`); await new Promise((r) => setTimeout(r)); }
  }
  parts.push('],"frames":[');
  for (let i = 0; i < frames.length; i++) {
    const f = { ...frames[i] };
    f.thumb = f.thumb ? await blobToDataUrl(f.thumb) : null;
    parts.push((i ? ',' : '') + JSON.stringify(f));
  }
  parts.push(']}');

  busy(false);
  const stamp = new Date().toISOString().slice(0, 10);
  download(new Blob(parts, { type: 'application/json' }), `door-thumbnail-backup-${stamp}.json`);
  toast('バックアップを書き出しました');
}

export async function importBackup(file, { merge = true } = {}) {
  busy('読み込み中…');
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { busy(false); toast('ファイルを読めませんでした'); return false; }
  if (!data || data.format !== FORMAT) { busy(false); toast('形式が違います'); return false; }

  if (!merge) {
    await db.clear('photos');
    await db.clear('frames');
  }

  const photos = data.photos || [];
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    await db.put('photos', {
      ...p,
      blob: await dataUrlToBlob(p.blob),
      thumb: p.thumb ? await dataUrlToBlob(p.thumb) : null,
    });
    if (i % 10 === 0) { busy(`読み込み中… ${i + 1}/${photos.length}`); await new Promise((r) => setTimeout(r)); }
  }
  for (const f of data.frames || []) {
    await db.put('frames', { ...f, thumb: f.thumb ? await dataUrlToBlob(f.thumb) : null });
  }
  for (const m of data.meta || []) await db.put('meta', m);

  busy(false);
  toast(`写真 ${photos.length}枚 / コマ ${(data.frames || []).length} を復元しました`);
  return true;
}

/** Delete photos that no frame references. */
export async function purgeUnused() {
  const [photos, frames] = await Promise.all([db.all('photos'), db.all('frames')]);
  const used = new Set();
  frames.forEach((f) => f.cells.forEach((c) => c.photoId && used.add(c.photoId)));
  const dead = photos.filter((p) => !used.has(p.id));
  if (!dead.length) { toast('未使用の写真はありません'); return 0; }
  if (!confirm(`どのコマでも使っていない写真 ${dead.length}枚 を削除します。よろしいですか？`)) return 0;
  for (const p of dead) {
    await db.del('photos', p.id);
    forgetBitmap(p.id);
    releaseThumb(p.id);
  }
  toast(`${dead.length}枚 削除しました`);
  return dead.length;
}

export async function usageText() {
  if (!navigator.storage || !navigator.storage.estimate) return '';
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  return quota ? `使用容量 ${mb(usage)} / 上限 約${mb(quota)}` : `使用容量 ${mb(usage)}`;
}
