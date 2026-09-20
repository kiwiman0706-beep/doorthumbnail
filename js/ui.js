// Tiny DOM / feedback helpers.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

let toastTimer = 0;
export function toast(msg, ms = 2200) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

export function busy(text) {
  const el = $('#busy');
  if (!el) return;
  if (text === false) { el.hidden = true; return; }
  $('#busy-text').textContent = text || '処理中…';
  el.hidden = false;
}

function framed() {
  try { return window.top !== window.self; } catch { return true; }
}

/**
 * Sandboxed iframes and iOS Safari ignore `<a download>`, so the file would
 * vanish silently. Show it instead and let the viewer save it by hand.
 */
function saveFallback(blob, filename) {
  const box = document.createElement('div');
  box.className = 'saveover';
  const note = document.createElement('p');

  if (/^image\//.test(blob.type)) {
    const url = URL.createObjectURL(blob);
    const img = document.createElement('img');
    img.src = url;
    img.alt = filename;
    box.appendChild(img);
    note.textContent = 'この環境ではファイル保存がブロックされています。画像を長押し（PC は右クリック）して保存してください。';
    box.addEventListener('remove', () => URL.revokeObjectURL(url));
  } else {
    const pre = document.createElement('pre');
    blob.text().then((t) => { pre.textContent = t.slice(0, 20000); });
    box.appendChild(pre);
    note.textContent = `この環境ではファイル保存がブロックされています（${filename}）。下の「コピー」から取り出してください。`;
  }
  box.appendChild(note);

  const row = document.createElement('div');
  row.className = 'row';
  if (!/^image\//.test(blob.type)) {
    const c = document.createElement('button');
    c.className = 'btn';
    c.textContent = '📋 コピー';
    c.addEventListener('click', async () => {
      toast((await copyText(await blob.text())) ? 'コピーしました' : 'コピーできませんでした');
    });
    row.appendChild(c);
  }
  const close = document.createElement('button');
  close.className = 'btn primary';
  close.textContent = '閉じる';
  close.addEventListener('click', () => box.remove());
  row.appendChild(close);
  box.appendChild(row);

  document.body.appendChild(box);
}

export function download(blob, filename) {
  const a = document.createElement('a');
  if (framed() || !('download' in a)) { saveFallback(blob, filename); return; }
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Web Share with files (Android Chrome / iOS Safari). Returns false if unsupported. */
export async function shareFiles(files, title, text) {
  if (!navigator.canShare || !navigator.canShare({ files })) return false;
  try {
    await navigator.share({ files, title, text });
    return true;
  } catch (e) {
    if (e && e.name === 'AbortError') return true;
    return false;
  }
}

export async function shareText(text, title) {
  if (!navigator.share) return false;
  try { await navigator.share({ title, text }); return true; }
  catch (e) { return e && e.name === 'AbortError'; }
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { /* fall through to the legacy path below */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand && document.execCommand('copy');
  ta.remove();
  return !!ok;
}

export function showView(id) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === id));
  window.scrollTo(0, 0);
}
