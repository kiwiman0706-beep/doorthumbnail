// Exercises the WebView UI in a desktop browser: the month screen must show the
// month's stock, and adopting must be a reversible toggle that keeps one copy of
// each image. Run with: node tools/smoke-web.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 8191;
const server = spawn(process.execPath, ['tools/serve-assets.mjs'], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
});
let browser;
const die = async (msg) => {
  console.error('FAIL:', msg);
  if (browser) await browser.close();
  server.kill();
  process.exit(1);
};
await new Promise((r) => setTimeout(r, 600));

browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/sw\.js|ServiceWorker/i.test(m.text())) errors.push(m.text()); });

await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForSelector('.month-cell', { timeout: 15000 });

// Real JPEG bytes, made in-page, then fed through the app's own file input.
const shots = await page.evaluate(async () => {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 640;
    const g = c.getContext('2d');
    g.fillStyle = `hsl(${i * 70} 65% 55%)`; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff'; g.font = 'bold 180px sans-serif'; g.textAlign = 'center';
    g.fillText(String(i + 1), 450, 400);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', .9));
    const buf = new Uint8Array(await blob.arrayBuffer());
    out.push(btoa(String.fromCharCode(...buf)));
  }
  return out;
});
const files = shots.map((b64, i) => ({ name: `s${i}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') }));

// Timeline -> month screen must be a single tap.
await page.locator('.month-cell').first().click();
await page.waitForSelector('#editorView:not([hidden])');
if (await page.locator('#candidateView').count()) await die('candidate view still exists');

await page.locator('#gatherPanel > summary').click();
await page.locator('#photoInput').setInputFiles(files);
await page.waitForFunction(() => document.querySelectorAll("#stockGrid .stock-thumb.adopted").length === 4, null, { timeout: 25000 });

const afterAdd = await page.evaluate(() => ({
  thumbs: document.querySelectorAll('#stockGrid .stock-thumb').length,
  adopted: document.querySelectorAll('#stockGrid .stock-thumb.adopted').length,
  photos: state.record?.photos.length,
}));
if (afterAdd.adopted !== 4) await die(`adopted ${afterAdd.adopted}/4 after add`);

// Adopted photos must reference the stock, not carry a second copy of the image.
const linked = await page.evaluate(() => {
  const photos = state.record.photos;
  return { withBlob: photos.filter((p) => p.blob).length, withId: photos.filter((p) => p.candidateId).length };
});
if (linked.withId !== 4 || linked.withBlob !== 0) await die(`photos not linked to stock: ${JSON.stringify(linked)}`);

// Un-adopt via the order badge: photo leaves the canvas, stays in the stock.
await page.locator('#stockGrid .stock-thumb.adopted .stock-order').first().click();
await page.waitForFunction(() => document.querySelectorAll('#stockGrid .stock-thumb.adopted').length === 3);
const afterUnadopt = await page.evaluate(() => ({
  thumbs: document.querySelectorAll('#stockGrid .stock-thumb').length,
  photos: state.record.photos.length,
}));
if (afterUnadopt.thumbs !== 4 || afterUnadopt.photos !== 3) await die(`un-adopt wrong: ${JSON.stringify(afterUnadopt)}`);

// Re-adopt the same photo: the toggle must go both ways.
await page.locator('#stockGrid .stock-thumb:not(.adopted) > button').first().click();
await page.waitForFunction(() => document.querySelectorAll('#stockGrid .stock-thumb.adopted').length === 4);

// Excluding drops it from the stock entirely.
await page.locator('#stockGrid .stock-thumb .stock-drop').first().click();
await page.waitForFunction(() => document.querySelectorAll('#stockGrid .stock-thumb').length === 3);
const afterDrop = await page.evaluate(() => state.record.photos.length);
if (afterDrop !== 3) await die(`exclude left ${afterDrop} photos, want 3`);

// The collage must actually be drawn.
const ink = await page.evaluate(() => {
  const c = document.querySelector('#collageCanvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4 * 101) if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) n++;
  return n;
});
if (ink < 100) await die(`canvas looks blank (${ink} samples)`);

// Back to the timeline: the month keeps its photos and reloads them from the stock.
await page.locator('#backButton').click();
await page.waitForSelector('#timelineView:not([hidden])');
await page.locator('.month-cell').first().click();
await page.waitForSelector('#editorView:not([hidden])');
await page.waitForFunction(() => document.querySelectorAll('#stockGrid .stock-thumb.adopted').length === 3, null, { timeout: 10000 });
const reloaded = await page.evaluate(() => ({
  images: state.images.size,
  photos: state.record.photos.length,
}));
if (reloaded.images !== 3 || reloaded.photos !== 3) await die(`reload lost images: ${JSON.stringify(reloaded)}`);

if (errors.length) await die(`console errors:\n${errors.join('\n')}`);
await browser.close();
server.kill();
console.log('PASS — single month screen, adopt/un-adopt toggle, stock-linked images, reload');
