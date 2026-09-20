// Single renderer shared by the editor preview, grid thumbnails, PNG export and the print sheet.
// Everything is expressed relative to the frame size, so any output resolution looks identical.

import { layoutRects, ymLabel } from './model.js';

/** Scale needed for an iw x ih image to cover a cw x ch box after rotating by `deg`. */
export function coverScale(iw, ih, cw, ch, deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const rw = cw * c + ch * s;
  const rh = cw * s + ch * c;
  return Math.max(rw / iw, rh / ih);
}

export function cellRects(frame, W, H) {
  const short = Math.min(W, H);
  return layoutRects(
    frame.layout,
    frame.split,
    W, H,
    (frame.padPct / 100) * short,
    (frame.gapPct / 100) * short,
  );
}

function drawPhoto(ctx, img, cell, r) {
  const iw = img.width;
  const ih = img.height;
  const base = coverScale(iw, ih, r.w, r.h, cell.rot || 0);
  const s = base * (cell.zoom || 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.translate(r.x + r.w / 2 + (cell.ox || 0) * r.w, r.y + r.h / 2 + (cell.oy || 0) * r.h);
  if (cell.rot) ctx.rotate((cell.rot * Math.PI) / 180);
  ctx.drawImage(img, (-iw * s) / 2, (-ih * s) / 2, iw * s, ih * s);
  ctx.restore();
}

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    // Japanese has no spaces, so wrap per character and keep ASCII words intact.
    const tokens = para.match(/[A-Za-z0-9._@:/+-]+|\s|[\s\S]/g) || [];
    for (const tk of tokens) {
      const next = line + tk;
      if (ctx.measureText(next).width > maxW && line) { out.push(line); line = tk === ' ' ? '' : tk; }
      else line = next;
    }
    out.push(line);
  }
  return out;
}

function drawStamp(ctx, frame, W, H) {
  if (!frame.stamp || !frame.stamp.show) return;
  const text = ymLabel(frame.year, frame.month);
  const short = Math.min(W, H);
  const pad = short * 0.035;

  if (frame.stamp.style === 'bar') {
    const barH = short * 0.085;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, H - barH, W, barH);
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${barH * 0.52}px ui-sans-serif, system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W - pad, H - barH / 2);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.font = `600 ${short * 0.055}px ui-sans-serif, system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = short * 0.02;
  ctx.fillStyle = '#fff';
  ctx.fillText(text, W - pad, H - pad);
  ctx.restore();
}

function drawCaption(ctx, frame, W, H) {
  const cap = frame.caption;
  if (!cap || !cap.show || !cap.text.trim()) return;
  const short = Math.min(W, H);
  const size = (cap.sizePct / 100) * short;
  const pad = short * 0.045;
  ctx.save();
  ctx.font = `500 ${size}px ui-sans-serif, system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`;
  ctx.textAlign = cap.align || 'center';
  ctx.textBaseline = 'bottom';
  const lines = wrapLines(ctx, cap.text.trim(), W - pad * 2);
  const lh = size * 1.3;
  // Keep clear of the burned-in year/month so the two never overlap.
  const st = frame.stamp || {};
  const stampGap = !st.show ? 0 : st.style === 'bar' ? short * 0.1 : short * 0.105;
  let y = H - pad - stampGap;
  const x = cap.align === 'left' ? pad : cap.align === 'right' ? W - pad : W / 2;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (cap.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = size * 0.35;
      ctx.lineWidth = size * 0.16;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(lines[i], x, y);
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = cap.color || '#fff';
    ctx.fillText(lines[i], x, y);
    y -= lh;
  }
  ctx.restore();
}

/**
 * Draw one frame onto a 2D context sized W x H.
 * `imgs` maps photoId -> ImageBitmap / HTMLImageElement.
 * opts.selected draws the editor's selection outline (-1 for output).
 */
export function renderFrame(ctx, frame, imgs, W, H, opts = {}) {
  const selected = opts.selected ?? -1;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = frame.bg || '#fff';
  ctx.fillRect(0, 0, W, H);

  const rects = cellRects(frame, W, H);
  rects.forEach((r, i) => {
    const cell = frame.cells[i];
    const img = cell && cell.photoId ? imgs.get(cell.photoId) : null;
    if (img) {
      drawPhoto(ctx, img, cell, r);
    } else if (opts.placeholders !== false) {
      ctx.save();
      ctx.fillStyle = '#e9edf2';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#c3ccd6';
      ctx.lineWidth = Math.max(1, Math.min(W, H) * 0.004);
      ctx.setLineDash([Math.min(W, H) * 0.02, Math.min(W, H) * 0.02]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
      const s = Math.min(r.w, r.h) * 0.22;
      ctx.strokeStyle = '#9aa7b4';
      ctx.lineWidth = Math.max(1, s * 0.12);
      ctx.beginPath();
      ctx.moveTo(r.x + r.w / 2 - s / 2, r.y + r.h / 2);
      ctx.lineTo(r.x + r.w / 2 + s / 2, r.y + r.h / 2);
      ctx.moveTo(r.x + r.w / 2, r.y + r.h / 2 - s / 2);
      ctx.lineTo(r.x + r.w / 2, r.y + r.h / 2 + s / 2);
      ctx.stroke();
      ctx.restore();
    }
  });

  drawCaption(ctx, frame, W, H);
  drawStamp(ctx, frame, W, H);

  if (selected >= 0 && rects[selected]) {
    const r = rects[selected];
    ctx.save();
    ctx.strokeStyle = '#ff5a36';
    ctx.lineWidth = Math.max(2, Math.min(W, H) * 0.012);
    ctx.strokeRect(r.x + ctx.lineWidth / 2, r.y + ctx.lineWidth / 2, r.w - ctx.lineWidth, r.h - ctx.lineWidth);
    ctx.restore();
  }
  ctx.restore();
  return rects;
}

/** Render a frame to an offscreen canvas at the given pixel size. */
export function renderToCanvas(frame, imgs, W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  renderFrame(ctx, frame, imgs, W, H, { selected: -1, placeholders: true });
  return c;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.94) {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}
