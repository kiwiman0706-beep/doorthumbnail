// First-run sample data. Draws stand-in "photos" on a canvas so the timeline,
// the editor and both print paths can be tried before any real photo is imported.

import { db } from './db.js';
import { importFiles } from './photos.js';
import { autoSlot } from './autoslot.js';
import { frameId } from './model.js';

const EVENTS = [
  { m: 1,  t: '初詣',         n: '家族4人・近所の神社',  words: ['初詣', 'おみくじ'] },
  { m: 2,  t: '雪あそび',     n: '志賀高原',             words: ['雪だるま', 'そり'] },
  { m: 3,  t: 'お花見',       n: '近所の川沿い',         words: ['桜', 'お弁当'] },
  { m: 4,  t: '入園式',       n: '娘・年少',             words: ['入園式', '記念写真'] },
  { m: 5,  t: '潮干狩り',     n: '3家族で',              words: ['あさり', '海'] },
  { m: 6,  t: '誕生日',       n: '5歳・ケーキは苺',      words: ['ケーキ', 'ろうそく'] },
  { m: 7,  t: '海水浴',       n: '白浜・2泊',            words: ['海', 'すいか'] },
  { m: 8,  t: '花火大会',     n: '淀川・屋台',           words: ['花火', 'かき氷'] },
  { m: 9,  t: '運動会',       n: 'かけっこ2位',          words: ['運動会', 'お弁当'] },
  { m: 10, t: '紅葉狩り',     n: '京都・嵐山',           words: ['紅葉', '嵐山'] },
  { m: 11, t: '七五三',       n: '娘・5歳',              words: ['七五三', '千歳飴'] },
  { m: 12, t: 'クリスマス',   n: '自宅でチキン',         words: ['ツリー', 'プレゼント'] },
];

const SKIES = [
  ['#8ec5e8', '#e8f3fa'], ['#f6b17a', '#f9e2c0'], ['#7fb2a5', '#dceee8'],
  ['#b39ddb', '#ece4f6'], ['#e58fa8', '#fae3ea'], ['#f2d06b', '#fbf3d8'],
];

function drawPhoto(word, seed) {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 900;
  const g = c.getContext('2d');
  const [a, b] = SKIES[seed % SKIES.length];

  const sky = g.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, a); sky.addColorStop(1, b);
  g.fillStyle = sky; g.fillRect(0, 0, c.width, c.height);

  // sun / lantern
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.beginPath();
  g.arc(240 + (seed * 97) % 700, 200 + (seed * 53) % 160, 90, 0, Math.PI * 2);
  g.fill();

  // rolling ground
  g.fillStyle = `hsl(${(seed * 47) % 360} 34% 42%)`;
  g.beginPath();
  g.moveTo(0, c.height);
  for (let x = 0; x <= c.width; x += 40) {
    g.lineTo(x, c.height - 250 - Math.sin((x + seed * 60) / 260) * 70);
  }
  g.lineTo(c.width, c.height);
  g.closePath();
  g.fill();

  // two figures, so faces-ish shapes sit where a crop would matter
  for (let i = 0; i < 2; i++) {
    const x = c.width / 2 + (i ? 130 : -130);
    const y = c.height - 210;
    g.fillStyle = `hsl(${(seed * 71 + i * 150) % 360} 55% 58%)`;
    g.beginPath(); g.ellipse(x, y + 120, 70, 120, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f3d9bd';
    g.beginPath(); g.arc(x, y, 52, 0, Math.PI * 2); g.fill();
  }

  g.fillStyle = 'rgba(0,0,0,.42)';
  g.font = 'bold 96px "Hiragino Sans","Noto Sans JP",sans-serif';
  g.textAlign = 'center';
  g.fillText(word, c.width / 2, 130);
  g.fillStyle = '#fff';
  g.fillText(word, c.width / 2, 124);

  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
}

/** Build three years of sample months and slot them exactly like real photos. */
export async function loadSamples(onProgress) {
  const thisYear = new Date().getFullYear();
  const thisMonth = new Date().getMonth() + 1;
  const files = [];
  const plan = [];

  for (let y = thisYear - 2; y <= thisYear; y++) {
    for (const ev of EVENTS) {
      if (y === thisYear && ev.m > thisMonth) continue;
      if ((y + ev.m) % 5 === 0) continue;                 // leave some months empty
      const count = 1 + ((y + ev.m * 3) % 4);             // 1-4 photos per month
      for (let k = 0; k < count; k++) {
        const seed = y * 37 + ev.m * 7 + k;
        const word = ev.words[k % ev.words.length];
        files.push({ blob: await drawPhoto(word, seed), y, m: ev.m, k });
      }
      plan.push({ y, ...ev });
    }
  }

  const asFiles = files.map((f, i) => new File(
    [f.blob], `sample-${f.y}-${f.m}-${f.k}.jpg`,
    { type: 'image/jpeg', lastModified: Date.UTC(f.y, f.m - 1, 8 + f.k, 12) },
  ));

  const added = await importFiles(asFiles, onProgress);
  await autoSlot(added);

  // Fill in the TEPRA label text so the label screen has something real to show.
  for (const p of plan) {
    const f = await db.get('frames', frameId(p.y, p.m, 0));
    if (!f || !f.hasContent) continue;
    f.label = { title: p.t, note: p.n };
    await db.put('frames', f);
  }
  await db.setting('range', { from: thisYear - 2, to: thisYear });
  await db.setting('sampleLoaded', true);
  return added.length;
}

export async function isEmpty() {
  const [p, f] = await Promise.all([db.all('photos'), db.all('frames')]);
  return p.length === 0 && f.length === 0;
}
