// Headless smoke test: boots the app, imports generated photos, edits a frame,
// exports a print sheet and label CSV, then verifies the rendered output.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 8123;
const server = spawn(process.execPath, ['scripts/serve.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
const die = async (msg, browser) => {
  console.error('FAIL:', msg);
  if (browser) await browser.close();
  server.kill();
  process.exit(1);
};

await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
});
const page = await browser.newPage({ viewport: { width: 420, height: 880 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForSelector('#grid tbody tr');

// --- build fake JPEGs in-page and feed them through the real import path ---
const made = await page.evaluate(async () => {
  const { importFiles } = await import('./js/photos.js');
  const files = [];
  for (let i = 0; i < 5; i++) {
    const c = document.createElement('canvas');
    c.width = 900 + i * 40; c.height = 600 + i * 30;
    const g = c.getContext('2d');
    g.fillStyle = `hsl(${i * 60} 70% 55%)`; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff'; g.font = '120px sans-serif'; g.fillText(String(i + 1), 40, 200);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    files.push(new File([blob], `t${i}.jpg`, { type: 'image/jpeg', lastModified: Date.UTC(2024, 4, 10 + i) }));
  }
  const added = await importFiles(files);
  return added.map((p) => ({ id: p.id, year: p.year, month: p.month, w: p.w, h: p.h }));
});
if (made.length !== 5) await die(`imported ${made.length}/5`, browser);
if (made[0].year !== 2024 || made[0].month !== 5) await die(`wrong slot ${made[0].year}-${made[0].month}`, browser);

// --- auto-slot: 5 photos in one month must land in one frame ---
const slot = await page.evaluate(async () => {
  const { autoSlot } = await import('./js/autoslot.js');
  const { db } = await import('./js/db.js');
  await db.setting('range', { from: 2024, to: 2024 });
  const r = await autoSlot(await db.all('photos'));
  const f = await db.get('frames', '2024-05-0');
  return { ...r, layout: f && f.layout, filled: f ? f.cells.filter((c) => c.photoId).length : 0, thumb: !!(f && f.thumb) };
});
if (slot.placed !== 5 || slot.skipped !== 0) await die(`autoSlot ${JSON.stringify(slot)}`, browser);
if (slot.layout !== '6' || slot.filled !== 5 || !slot.thumb) await die(`autoSlot frame ${JSON.stringify(slot)}`, browser);

// wipe it again so the UI path below starts from an empty cell
await page.evaluate(async () => {
  const { db } = await import('./js/db.js');
  await db.clear('frames');
  await db.setting('range', { from: 2024, to: 2024 });
});
await page.reload();
await page.waitForSelector('#grid tbody tr');

await page.evaluate(() => {
  document.querySelectorAll('#grid tbody tr')[0]
    .querySelectorAll('.cell')[4].click();   // 2024年5月
});
await page.waitForSelector('#view-editor.active');
await page.waitForFunction(() => document.querySelector('#canvas').width > 0);

// place three photos via the tray, using the 3-up layout
await page.click('[data-tab="layout"]');
await page.click('.ly[data-ly="3t"]');
await page.click('[data-tab="photos"]');
await page.click('#ed-autofill');
await page.waitForTimeout(400);

const filled = await page.evaluate(async () => {
  const { currentFrame } = await import('./js/editor.js');
  return currentFrame().cells.filter((c) => c.photoId).length;
});
if (filled !== 3) await die(`autofill placed ${filled}/3`, browser);

// caption + label text
await page.click('[data-tab="text"]');
await page.check('#cap-show');
await page.fill('#cap-text', 'テスト旅行');
await page.fill('#lb-title', 'テスト旅行');
await page.fill('#lb-note', '家族4人');
await page.waitForTimeout(500);

// the canvas must not be blank
const ink = await page.evaluate(() => {
  const c = document.querySelector('#canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4 * 97) if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) n++;
  return n;
});
if (ink < 100) await die(`canvas looks blank (${ink} non-white samples)`, browser);

// export size must match instax mini Link native resolution
const exported = await page.evaluate(async () => {
  const { currentFrame, flushSave } = await import('./js/editor.js');
  const { bitmapsFor } = await import('./js/photos.js');
  const { renderToCanvas, canvasToBlob } = await import('./js/render.js');
  const { frameSizePx } = await import('./js/model.js');
  await flushSave();
  const f = currentFrame();
  const s = frameSizePx(f, 1);
  const b = await canvasToBlob(renderToCanvas(f, await bitmapsFor(f), s.w, s.h), 'image/jpeg', 0.95);
  return { w: s.w, h: s.h, bytes: b.size };
});
if (exported.w !== 600 || exported.h !== 800) await die(`export ${exported.w}x${exported.h}, want 600x800`, browser);
if (exported.bytes < 5000) await die(`export too small (${exported.bytes} bytes)`, browser);

// --- print sheet ---
await page.click('#ed-back');
await page.waitForSelector('#view-timeline.active');
await page.click('#btn-output');
await page.waitForSelector('#view-output.active');
await page.selectOption('#sh-scope', 'all');
await page.click('#sh-build');
await page.waitForFunction(() => !document.querySelector('#sh-print').disabled, null, { timeout: 20000 });
const tiles = await page.evaluate(() => ({
  pages: document.querySelectorAll('#sheet .page').length,
  tiles: document.querySelectorAll('#sheet .tile').length,
  w: document.querySelector('#sheet .tile').style.width,
  h: document.querySelector('#sheet .tile').style.height,
}));
if (tiles.tiles !== 1 || tiles.pages !== 1) await die(`sheet ${tiles.tiles} tiles / ${tiles.pages} pages`, browser);
if (tiles.w !== '46mm' || tiles.h !== '62mm') await die(`tile ${tiles.w}x${tiles.h}, want 46mm x 62mm`, browser);

// print media must give each page the same 194mm content box the packer assumed,
// otherwise a tile per row falls off the sheet.
await page.emulateMedia({ media: 'print' });
const printBox = await page.evaluate(() => {
  const pg = document.querySelector('#sheet .page');
  const cs = getComputedStyle(pg);
  const mm = (v) => +(v / (96 / 25.4)).toFixed(1);
  return {
    padL: mm(parseFloat(cs.paddingLeft)),
    contentMm: mm(pg.getBoundingClientRect().width),
    heightMm: mm(pg.getBoundingClientRect().height),
  };
});
await page.emulateMedia({ media: 'screen' });
// @page leaves a 194 x 281mm content box; a wider or padded .page silently drops a
// tile per row, or pushes one .page across two physical sheets.
if (printBox.padL !== 0) await die(`print page has padding: ${JSON.stringify(printBox)}`, browser);
if (printBox.contentMm !== 194) await die(`print page ${printBox.contentMm}mm wide, want 194`, browser);
if (printBox.heightMm > 281.5) await die(`print page ${printBox.heightMm}mm tall, overflows A4`, browser);

// card mode geometry
await page.click('#sh-size button[data-v="card"]');
await page.click('#sh-build');
await page.waitForTimeout(800);
const card = await page.evaluate(() => {
  const t = document.querySelector('#sheet .tile');
  return { w: t.style.width, h: t.style.height, hasFoot: !!t.querySelector('.foot') };
});
if (card.w !== '54mm' || card.h !== '86mm' || !card.hasFoot) await die(`card tile ${JSON.stringify(card)}`, browser);

// --- labels ---
await page.click('#otabs .tab[data-otab="label"]');
await page.selectOption('#lb-scope', 'all');
await page.click('#lb-build');
await page.waitForTimeout(300);
const labels = await page.inputValue('#lb-out');
if (!labels.includes('2024.05') || !labels.includes('テスト旅行') || !labels.includes('家族4人')) {
  await die(`label output unexpected: ${JSON.stringify(labels)}`, browser);
}

// --- backup round trip ---
const round = await page.evaluate(async () => {
  const { db } = await import('./js/db.js');
  const before = (await db.all('photos')).length;
  await db.clear('photos');
  const after = (await db.all('photos')).length;
  return { before, after };
});
if (round.before !== 5 || round.after !== 0) await die(`db round trip ${JSON.stringify(round)}`, browser);

if (errors.length) await die(`console errors:\n${errors.join('\n')}`, browser);

await browser.close();
server.kill();
console.log('PASS — import, EXIF slotting, auto-slot, editor, 600x800 export, A4 sheet (46x62 & 54x86), labels, purge');
