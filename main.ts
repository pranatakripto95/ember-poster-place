// Ember Poster Place — a travel poster for VELMARA, a place that does not exist.
// Draws the whole poster in code (no external images, no fonts, no network):
// a 5x7 bitmap typeface rendered by hand, a vector rasterizer, and a
// hand-rolled PNG encoder (zlib + CRC32, stdlib only).
// Writes /output/entry.png (768x1024, under the 1 MiB cap).
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const W = 768;
const H = 1024;
const buf = new Uint8Array(W * H * 3);

// ---------- colour helpers ----------
type RGB = [number, number, number];
const rgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const lerp = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const blend = (dst: RGB, src: RGB, a: number): RGB => [
  Math.round(src[0] * a + dst[0] * (1 - a)),
  Math.round(src[1] * a + dst[1] * (1 - a)),
  Math.round(src[2] * a + dst[2] * (1 - a)),
];

// ---------- pixel primitives ----------
function setPx(x: number, y: number, c: RGB, a = 1) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  if (a >= 1) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; return; }
  buf[i] = Math.round(c[0] * a + buf[i] * (1 - a));
  buf[i + 1] = Math.round(c[1] * a + buf[i + 1] * (1 - a));
  buf[i + 2] = Math.round(c[2] * a + buf[i + 2] * (1 - a));
}
function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1) {
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) setPx(x, y, c, a);
}
function vGradient(y0: number, y1: number, stops: [number, RGB][]) {
  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / (y1 - y0);
    let c = stops[stops.length - 1][1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        const lt = (t - stops[s][0]) / (stops[s + 1][0] - stops[s][0]);
        c = lerp(stops[s][1], stops[s + 1][1], lt);
        break;
      }
    }
    for (let x = 0; x < W; x++) setPx(x, y, c);
  }
}
function disc(cx: number, cy: number, r: number, c: RGB, a = 1) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) setPx(x, y, c, a);
    }
}
function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPx(x, y, c, a);
    }
}
// soft glow: radial falloff disc
function glow(cx: number, cy: number, r: number, c: RGB, peak: number) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d < 1) setPx(x, y, c, peak * (1 - d) * (1 - d));
    }
}
function poly(points: [number, number][], c: RGB, a = 1) {
  const minY = Math.floor(Math.min(...points.map((p) => p[1])));
  const maxY = Math.ceil(Math.max(...points.map((p) => p[1])));
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.ceil(xs[k]); x <= xs[k + 1]; x++) setPx(x, y, c, a);
  }
}
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 1) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(len);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, c, a);
  }
}

// ---------- 5x7 bitmap typeface (uppercase, digits, punctuation) ----------
const GLYPHS: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ",": [0, 0, 0, 0, 0x0c, 0x04, 0x08],
  "-": [0, 0, 0, 0x1f, 0, 0, 0],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  "·": [0, 0x04, 0x04, 0, 0, 0, 0],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
};
function textWidth(s: string, scale: number, tracking = 1): number {
  return s.length * (5 + tracking) * scale - tracking * scale;
}
function drawText(s: string, cx: number, y: number, scale: number, c: RGB, tracking = 1) {
  const w = textWidth(s, scale, tracking);
  let x = Math.round(cx - w / 2);
  for (const ch of s.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < 5; col++)
        if (g[row] & (1 << (4 - col)))
          fillRect(x + col * scale, y + row * scale, x + (col + 1) * scale, y + (row + 1) * scale, c);
    x += (5 + tracking) * scale;
  }
}
function drawTextOutline(s: string, cx: number, y: number, scale: number, c: RGB, outline: RGB, ox: number) {
  for (const [dx, dy] of [[-ox, 0], [ox, 0], [0, -ox], [0, ox], [-ox, -ox], [ox, ox], [-ox, ox], [ox, -ox]])
    drawText(s, cx + dx, y + dy, scale, outline);
  drawText(s, cx, y, scale, c);
}

// ---------- palette ----------
const TEAL = rgb("#14333f");
const TEAL_D = rgb("#0e2833");
const CREAM = rgb("#f7ead0");
const GOLD = rgb("#f2b25c");
const SUN = rgb("#ffe9a8");

// ---------- 1. sky ----------
vGradient(0, 640, [
  [0, rgb("#16324a")],
  [0.45, rgb("#2e6b78")],
  [0.75, rgb("#e08a45")],
  [1, rgb("#f6c453")],
]);
// faint stars in the upper sky
for (let i = 0; i < 40; i++) {
  const x = (i * 173) % 740 + 14, y = (i * 97) % 150 + 30;
  if ((i * 7) % 3 === 0) setPx(x, y, rgb("#f7ead0"), 0.7);
}

// ---------- 2. sun + glow (high in the sky, clear of the island) ----------
glow(560, 420, 220, rgb("#ffd98a"), 0.55);
glow(560, 420, 130, rgb("#ffe9a8"), 0.7);
disc(560, 420, 78, SUN);
disc(560, 420, 78, rgb("#fff3c4"), 0.35);

// ---------- 3. distant birds ----------
function bird(x: number, y: number, s: number, c: RGB) {
  thickLine(x - s, y, x, y - s * 0.5, 3, c);
  thickLine(x, y - s * 0.5, x + s, y, 3, c);
}
bird(180, 300, 14, TEAL_D);
bird(230, 270, 11, TEAL_D);
bird(590, 250, 12, TEAL_D);
bird(640, 300, 9, TEAL_D);
bird(140, 350, 9, TEAL_D);

// ---------- 4. cloud sea (base + billows) ----------
vGradient(600, H, [[0, rgb("#f2b25c")], [0.5, rgb("#e89a55")], [1, rgb("#c97a3d")]]);
const cloud = (cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1) => {
  ellipse(cx, cy, rx, ry, c, a);
  ellipse(cx - rx * 0.55, cy + ry * 0.25, rx * 0.6, ry * 0.7, c, a);
  ellipse(cx + rx * 0.55, cy + ry * 0.25, rx * 0.6, ry * 0.7, c, a);
};
cloud(180, 660, 170, 42, rgb("#fbecc9"));
cloud(560, 640, 200, 46, rgb("#fbecc9"));
cloud(384, 700, 230, 50, rgb("#f7d9a0"));
cloud(120, 760, 150, 40, rgb("#fbecc9"));
cloud(640, 770, 170, 44, rgb("#fbecc9"));
cloud(300, 830, 220, 48, rgb("#f7d9a0"));
cloud(620, 870, 180, 44, rgb("#fbecc9"));
cloud(150, 890, 170, 42, rgb("#f7d9a0"));
// cloud shadows for depth
cloud(420, 745, 190, 34, rgb("#d98d4e"), 0.55);
cloud(200, 815, 160, 30, rgb("#d98d4e"), 0.5);
cloud(480, 800, 150, 36, rgb("#fbecc9"), 0.9);
cloud(80, 700, 120, 32, rgb("#f7d9a0"), 0.9);

// ---------- 5. floating islets ----------
function islet(cx: number, cy: number, s: number) {
  ellipse(cx, cy, 70 * s, 20 * s, rgb("#7a9a4a"));
  ellipse(cx, cy - 4 * s, 60 * s, 14 * s, rgb("#8fae5c"));
  poly([[cx - 66 * s, cy + 2], [cx + 66 * s, cy + 2], [cx + 18 * s, cy + 78 * s], [cx, cy + 96 * s], [cx - 18 * s, cy + 78 * s]], rgb("#6b4a35"));
  poly([[cx - 40 * s, cy + 10], [cx + 40 * s, cy + 10], [cx, cy + 70 * s]], rgb("#7d5a40"), 0.8);
  pine(cx - 22 * s, cy - 26 * s, 22 * s);
  pine(cx + 18 * s, cy - 30 * s, 26 * s);
}
function pine(x: number, y: number, h: number) {
  poly([[x, y - h], [x - h * 0.45, y], [x + h * 0.45, y]], rgb("#2e5d43"));
  poly([[x, y - h * 0.75], [x - h * 0.32, y - h * 0.25], [x + h * 0.32, y - h * 0.25]], rgb("#3a7355"));
  fillRect(x - 1, y, x + 2, y + h * 0.18, rgb("#5a3d28"));
}
islet(105, 705, 0.7);
islet(625, 665, 0.95);

// ---------- 6. main island + lighthouse ----------
const IX = 384, IY = 520;
// rocky underside
poly([[IX - 250, IY], [IX + 250, IY], [IX + 90, IY + 130], [IX + 20, IY + 185], [IX, IY + 205], [IX - 20, IY + 185], [IX - 90, IY + 130]], rgb("#6b4a35"));
poly([[IX - 200, IY + 8], [IX + 200, IY + 8], [IX + 60, IY + 120], [IX, IY + 165], [IX - 60, IY + 120]], rgb("#7d5a40"), 0.85);
thickLine(IX - 150, IY + 55, IX + 120, IY + 70, 4, rgb("#54382a"), 0.7);
thickLine(IX - 90, IY + 110, IX + 80, IY + 120, 4, rgb("#54382a"), 0.6);
// grassy top
ellipse(IX, IY, 258, 52, rgb("#7a9a4a"));
ellipse(IX, IY - 6, 240, 42, rgb("#8fae5c"));
ellipse(IX - 90, IY - 10, 90, 22, rgb("#a3c06e"), 0.8);
// waterfall off the left edge into the clouds
poly([[IX - 235, IY + 6], [IX - 205, IY + 6], [IX - 190, IY + 150], [IX - 225, IY + 150]], rgb("#cfe8ef"), 0.9);
poly([[IX - 228, IY + 6], [IX - 212, IY + 6], [IX - 200, IY + 150], [IX - 216, IY + 150]], rgb("#f4fbff"), 0.9);
cloud(IX - 210, IY + 155, 55, 16, rgb("#fbecc9"));
// pine trees on the island
pine(IX - 190, IY - 30, 46);
pine(IX - 140, IY - 38, 56);
pine(IX + 150, IY - 32, 48);
pine(IX + 200, IY - 26, 40);
// lighthouse
const LX = IX + 30, LY = IY - 40;
poly([[LX - 26, LY], [LX + 26, LY], [LX + 16, LY - 118], [LX - 16, LY - 118]], rgb("#fbf3df"));
poly([[LX - 20, LY - 30], [LX + 20, LY - 30], [LX + 18, LY - 62], [LX - 18, LY - 62]], rgb("#d94f3d"));
fillRect(LX - 24, LY - 122, LX + 24, LY - 114, TEAL_D);
poly([[LX - 18, LY - 118], [LX + 18, LY - 118], [LX, LY - 146]], TEAL_D);
fillRect(LX - 8, LY - 112, LX + 8, LY - 96, rgb("#ffd98a")); // lit lamp window under the cap
fillRect(LX - 3, LY - 78, LX + 3, LY - 62, TEAL_D);
fillRect(LX - 3, LY - 30, LX + 3, LY - 14, TEAL_D);
// light beam to the right
poly([[LX + 8, LY - 132], [LX + 300, LY - 168], [LX + 300, LY - 96], [LX + 8, LY - 122]], rgb("#ffe9a8"), 0.28);
poly([[LX + 8, LY - 132], [LX + 210, LY - 152], [LX + 210, LY - 112], [LX + 8, LY - 122]], rgb("#ffe9a8"), 0.3);
// small cottage beside the lighthouse
poly([[LX - 108, LY], [LX - 48, LY], [LX - 48, LY - 34], [LX - 108, LY - 34]], rgb("#fbf3df"));
poly([[LX - 114, LY - 32], [LX - 42, LY - 32], [LX - 78, LY - 56]], rgb("#d94f3d"));
fillRect(LX - 84, LY - 18, LX - 72, LY, TEAL_D);

// ---------- 7. frame ----------
fillRect(0, 0, W, 26, TEAL);
fillRect(0, H - 26, W, H, TEAL);
fillRect(0, 0, 26, H, TEAL);
fillRect(W - 26, 0, W, H, TEAL);
fillRect(26, 26, W - 26, 30, GOLD);
fillRect(26, H - 30, W - 26, H - 26, GOLD);
fillRect(26, 26, 30, H - 26, GOLD);
fillRect(W - 30, 26, W - 26, H - 26, GOLD);

// ---------- 8. type ----------
// Title over the sky
drawTextOutline("VELMARA", W / 2, 62, 14, CREAM, TEAL_D, 4);
// gold rule + diamond ornament
fillRect(W / 2 - 150, 178, W / 2 - 40, 182, GOLD);
fillRect(W / 2 + 40, 178, W / 2 + 150, 182, GOLD);
poly([[W / 2, 168], [W / 2 + 10, 180], [W / 2, 192], [W / 2 - 10, 180]], GOLD);
drawText("THE FLOATING ISLES", W / 2, 200, 5, CREAM);
// tagline over the cloud sea
drawTextOutline("WHERE THE SUN NEVER SETS", W / 2, 862, 3, TEAL_D, CREAM, 2);
// bottom band small print
fillRect(30, 936, W - 30, 994, TEAL_D);
drawText("WEEKLY STEAMERS FROM PORT LUMEN · EST. 1927", W / 2, 956, 2, CREAM);

// ---------- PNG encode ----------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const byte of b) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    raw.set(buf.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const png = encodePNG();
let outDir = "/output";
try { mkdirSync(outDir, { recursive: true }); } catch { outDir = "./output"; mkdirSync(outDir, { recursive: true }); }
writeFileSync(`${outDir}/entry.png`, png);
console.log(`wrote ${outDir}/entry.png ${png.length} bytes ${W}x${H}`);
