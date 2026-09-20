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

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
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
