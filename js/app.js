// App wiring: routing between the three views, photo intake, auto-slotting, export/share.

import { db } from './db.js';
import { bitmapsFor, importFiles } from './photos.js';
import { frameSizePx, ymLabel } from './model.js';
import { renderToCanvas, canvasToBlob } from './render.js';
import { autoSlot } from './autoslot.js';
import { initEditor, openFrame, currentFrame, flushSave, redraw } from './editor.js';
import { initTimeline, refresh as refreshTimeline, loadRange, extendRangeTo } from './timeline.js';
import { initOutput, markPrinted } from './output.js';
import { exportBackup, importBackup, purgeUnused, usageText } from './backup.js';
import { $, showView, toast, busy, download, shareFiles } from './ui.js';

/* ---------------- routing ---------------- */

function goTimeline() {
  showView('view-timeline');
  history.replaceState({ v: 'timeline' }, '');
}

async function goEditor(y, m, idx = 0) {
  showView('view-editor');
  history.pushState({ v: 'editor', y, m, idx }, '');
  await openFrame(y, m, idx);
}

function goOutput() {
  showView('view-output');
  history.pushState({ v: 'output' }, '');
}

async function leaveEditor() {
  await flushSave();
  await refreshTimeline();
  goTimeline();
}

/* ---------------- photo intake ---------------- */

/** Photos handed over by the Android share sheet, parked in a Cache by the service worker. */
async function collectShared() {
  const q = new URLSearchParams(location.search);
  const n = parseInt(q.get('shared') || '0', 10);
  history.replaceState(null, '', location.pathname);
  if (!Number.isFinite(n) || n <= 0 || !('caches' in window)) return;

  const cache = await caches.open('door-thumbnail-share');
  const files = [];
  for (let i = 0; i < n; i++) {
    const res = await cache.match(`/__shared/${i}`);
    if (!res) continue;
    const name = decodeURIComponent(res.headers.get('x-filename') || `shared-${i}.jpg`);
    files.push(new File([await res.blob()], name, { type: res.headers.get('content-type') || 'image/jpeg' }));
  }
  for (const k of await cache.keys()) await cache.delete(k);
  if (!files.length) return;

  busy(`共有された写真を取り込み中… 0/${files.length}`);
  const added = await importFiles(files, (i, t) => busy(`共有された写真を取り込み中… ${i}/${t}`));
  let msg = `${added.length}枚 受け取りました`;
  if (added.length && (await db.setting('autoslot')) !== false) {
    const { placed } = await autoSlot(added, extendRangeTo);
    msg += ` / ${placed}枚 を年月のコマに配置`;
  }
  busy(false);
  toast(msg, 4000);
}

async function intake() {
  const input = $('#file-input');
  input.value = '';
  input.click();
  await new Promise((res) => { input.onchange = res; input.oncancel = res; });
  const files = [...(input.files || [])];
  if (!files.length) return;

  busy(`取り込み中… 0/${files.length}`);
  const added = await importFiles(files, (i, n) => busy(`取り込み中… ${i}/${n}`));
  let msg = `${added.length}枚 取り込みました`;
  if (added.length && (await db.setting('autoslot')) !== false) {
    busy('年月ごとに配置中…');
    const { placed, skipped } = await autoSlot(added, extendRangeTo);
    msg += ` / ${placed}枚 を年月のコマに配置`;
    if (skipped) msg += `（${skipped}枚 は空きなし）`;
  }
  busy(false);
  await refreshTimeline();
  toast(msg, 4000);
}

/* ---------------- editor export ---------------- */

async function exportPng(scale) {
  const frame = currentFrame();
  if (!frame) return null;
  await flushSave();
  const imgs = await bitmapsFor(frame);
  const size = frameSizePx(frame, scale);
  const canvas = renderToCanvas(frame, imgs, size.w, size.h);
  return canvasToBlob(canvas, 'image/jpeg', 0.95);
}

function exportName(frame, ext = 'jpg') {
  const base = `instax_${frame.year}-${String(frame.month).padStart(2, '0')}`;
  const t = (frame.label.title || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24);
  return t ? `${base}_${t}.${ext}` : `${base}.${ext}`;
}

/* ---------------- settings ---------------- */

async function openSettings() {
  const dlg = $('#dlg-settings');
  $('#set-autoslot').checked = (await db.setting('autoslot')) !== false;
  $('#set-usage').textContent = await usageText();
  dlg.showModal();
}

/* ---------------- boot ---------------- */

async function boot() {
  await loadRange();

  initTimeline({ onOpen: goEditor });
  initEditor({
    onSaved: () => { /* the timeline is rebuilt when we leave the editor */ },
    onExit: leaveEditor,
  });
  initOutput();

  $('#btn-import').addEventListener('click', intake);
  $('#btn-output').addEventListener('click', goOutput);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#ed-back').addEventListener('click', leaveEditor);
  $('#out-back').addEventListener('click', async () => { await refreshTimeline(); goTimeline(); });

  $('#out-save').addEventListener('click', async () => {
    const b = await exportPng(1);
    if (b) { download(b, exportName(currentFrame())); toast('保存しました（600×800）'); }
  });
  $('#out-save2x').addEventListener('click', async () => {
    const b = await exportPng(2);
    if (b) { download(b, exportName(currentFrame())); toast('保存しました（1200×1600）'); }
  });
  $('#out-share').addEventListener('click', async () => {
    const frame = currentFrame();
    const b = await exportPng(1);
    if (!b) return;
    const file = new File([b], exportName(frame), { type: 'image/jpeg' });
    const ok = await shareFiles([file], ymLabel(frame.year, frame.month), frame.label.title || '');
    if (!ok) { download(b, exportName(frame)); toast('共有に非対応のため保存しました。instax アプリで開いてください'); }
  });

  $('#bk-export').addEventListener('click', exportBackup);
  $('#bk-import').addEventListener('click', () => $('#restore-input').click());
  $('#restore-input').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (await importBackup(f)) { await loadRange(); await refreshTimeline(); redraw(); }
    e.target.value = '';
  });
  $('#bk-purge').addEventListener('click', async () => {
    if (await purgeUnused()) { await refreshTimeline(); $('#set-usage').textContent = await usageText(); }
  });
  $('#set-autoslot').addEventListener('change', (e) => db.setting('autoslot', e.target.checked));

  // Offer to tick "printed" after the browser's print dialog closes.
  window.addEventListener('afterprint', async () => {
    if (!$('#view-output').classList.contains('active')) return;
    if (!confirm('印刷したコマを「印刷済み」にしますか？')) return;
    const n = await markPrinted();
    if (n) toast(`${n} コマを印刷済みにしました`);
  });

  window.addEventListener('popstate', async (e) => {
    const v = (e.state && e.state.v) || 'timeline';
    if (v === 'editor' && e.state) { showView('view-editor'); await openFrame(e.state.y, e.state.m, e.state.idx); }
    else if (v === 'output') showView('view-output');
    else { await flushSave(); await refreshTimeline(); showView('view-timeline'); }
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
  window.addEventListener('pagehide', () => { flushSave(); });

  await collectShared();
  await loadRange();
  await refreshTimeline();
  goTimeline();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('afterbegin', `<pre style="padding:16px;color:#c00">起動に失敗しました: ${e && e.message}</pre>`);
});
