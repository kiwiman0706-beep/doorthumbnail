// Generates the PWA icons as PNGs with no image-library dependency.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function draw(size, padRatio) {
  const buf = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
  };
  const rect = (x, y, w, h, c) => {
    for (let j = Math.round(y); j < Math.round(y + h); j++)
      for (let i = Math.round(x); i < Math.round(x + w); i++) put(i, j, c);
  };

  rect(0, 0, size, size, hex('#ff5a36'));            // door-orange backdrop
  const pad = size * padRatio;
  const inner = size - pad * 2;
  rect(pad, pad, inner, inner, hex('#f7f5f1'));

  // 3 x 4 grid of little instax cards, in the frame colours from the door.
  const colours = ['#7fb2e5', '#f2a65a', '#8fcf8a', '#e58fa8', '#b39ddb', '#f2d06b',
                   '#6fc6c0', '#f28b82', '#9fc7f2', '#c9b79c', '#84c3a3', '#e5a3d1'];
  const cols = 3, rows = 4;
  const gap = inner * 0.055;
  const cw = (inner - gap * (cols + 1)) / cols;
  const ch = (inner - gap * (rows + 1)) / rows;
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = pad + gap + c * (cw + gap);
      const y = pad + gap + r * (ch + gap);
      rect(x, y, cw, ch, hex(colours[n++ % colours.length]));
      rect(x + cw * 0.1, y + ch * 0.09, cw * 0.8, ch * 0.62, hex('#ffffff'));
    }
  }
  return buf;
}

mkdirSync('icons', { recursive: true });
for (const s of [192, 512]) writeFileSync(`icons/icon-${s}.png`, png(s, s, draw(s, 0.04)));
writeFileSync('icons/maskable-512.png', png(512, 512, draw(512, 0.14)));
console.log('icons written');
