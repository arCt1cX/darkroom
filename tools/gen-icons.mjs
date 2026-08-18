/**
 * Genera le icone PNG della PWA senza dipendenze: stessa geometria del
 * favicon.svg, disegnata a mano e campionata 3x3 per l'antialiasing.
 *
 *   npm run icons
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const BG = [11, 10, 9];
const ACCENT = [255, 78, 51];

/* ------------------------------------------------------------------- PNG */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro "none"
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- disegno */

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function roundedRectDistance(px, py, side, radius) {
  const qx = Math.abs(px - side / 2) - (side / 2 - radius);
  const qy = Math.abs(py - side / 2) - (side / 2 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Un punto nello spazio 64x64 del favicon -> [r, g, b, a]. */
function shade(u, v, { maskable }) {
  const shell = maskable ? -1 : roundedRectDistance(u, v, 64, 14);
  const alpha = maskable ? 1 : clamp01(0.5 - shell * 8);
  if (alpha <= 0) return [0, 0, 0, 0];

  // Il segno del diaframma si restringe dentro la zona sicura delle maskable.
  const k = maskable ? 0.66 : 1;
  const mu = (u - 32) / k + 32;
  const mv = (v - 32) / k + 32;

  let color = BG.slice();

  // bagliore della lampada di sicurezza, in alto
  const glow = Math.exp(-(Math.hypot(u - 32, v - 6) ** 2) / 1500) * 0.5;
  color = color.map((c, i) => c + (ACCENT[i] - c) * glow * 0.35);

  const ring = Math.abs(Math.hypot(mu - 32, mv - 32) - 22) - 1.2;
  const blades = Math.min(
    segmentDistance(mu, mv, 32, 21, 32, 14.5),
    segmentDistance(mu, mv, 41.53, 37.5, 47.15, 40.75),
    segmentDistance(mu, mv, 22.47, 37.5, 16.85, 40.75)
  ) - 1.2;
  const dot = Math.hypot(mu - 32, mv - 32) - 6;

  const ink = clamp01(0.5 - Math.min(ring, blades, dot) * 6);
  color = color.map((c, i) => c + (ACCENT[i] - c) * ink);

  return [...color, alpha * 255];
}

function render(size, opts) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = 3; // supersampling
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const u = ((x + (sx + 0.5) / S) / size) * 64;
          const v = ((y + (sy + 0.5) / S) / size) * 64;
          const px = shade(u, v, opts);
          for (let i = 0; i < 4; i++) acc[i] += px[i];
        }
      }
      const at = (y * size + x) * 4;
      for (let i = 0; i < 4; i++) rgba[at + i] = Math.round(acc[i] / (S * S));
    }
  }
  return encodePng(size, rgba);
}

const jobs = [
  ["icon-192.png", 192, { maskable: false }],
  ["icon-512.png", 512, { maskable: false }],
  ["icon-180.png", 180, { maskable: false }],
  ["icon-maskable-512.png", 512, { maskable: true }],
];

for (const [name, size, opts] of jobs) {
  writeFileSync(join(OUT, name), render(size, opts));
  console.log("scritto", name, size + "px");
}
