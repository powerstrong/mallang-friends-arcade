/* Generates world/assets/mint_kitten_sheet_3x3.png — a 96x96 pixel-art
 * walk-cycle sprite sheet for the mint kitten world avatar.
 *
 * Layout: 3 cols x 3 rows of 32x32 frames.
 *   row 0 = facing DOWN, row 1 = facing RIGHT (side), row 2 = facing UP.
 *   col 0 = idle stand, col 1 = step A, col 2 = step B.
 * The world client mirrors row 1 horizontally for the LEFT direction.
 *
 * No image libraries: draws into an RGBA buffer and hand-encodes a PNG.
 * Run: node scripts/gen_mint_kitten_sheet.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SHEET = 96;            // 3 x 32
const FRAME = 32;

// ── Palette ──────────────────────────────────────────────────────────────────
const OUTLINE = [58, 52, 74];
const BODY    = [205, 236, 229]; // mint
const SHADE   = [165, 211, 201]; // mint shadow / feet
const WHITE   = [249, 253, 251]; // belly + muzzle
const PINK    = [255, 168, 194]; // ear inner + nose
const EYE     = [54, 49, 70];
const BLUSH   = [255, 200, 210];

// ── RGBA canvas ──────────────────────────────────────────────────────────────
const px = Buffer.alloc(SHEET * SHEET * 4); // transparent
// All drawing is in frame-local coords; OFF{X,Y} place it in the right cell.
let OFFX = 0, OFFY = 0;
function set(x, y, c) {
  x = (x + OFFX) | 0; y = (y + OFFY) | 0;
  if (x < 0 || y < 0 || x >= SHEET || y >= SHEET) return;
  const i = (y * SHEET + x) * 4;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
}

function ellipse(cx, cy, rx, ry, c) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) set(x, y, c);
    }
  }
}

// Filled ellipse with a 1px dark outline ring.
function blob(cx, cy, rx, ry, fill) {
  ellipse(cx, cy, rx + 1, ry + 1, OUTLINE);
  ellipse(cx, cy, rx, ry, fill);
}

function tri(p0, p1, p2, c) {
  const minX = Math.floor(Math.min(p0[0], p1[0], p2[0]));
  const maxX = Math.ceil(Math.max(p0[0], p1[0], p2[0]));
  const minY = Math.floor(Math.min(p0[1], p1[1], p2[1]));
  const maxY = Math.ceil(Math.max(p0[1], p1[1], p2[1]));
  const area = (a, b, p) =>
    (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const p = [x + 0.5, y + 0.5];
      const d1 = area(p0, p1, p), d2 = area(p1, p2, p), d3 = area(p2, p0, p);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) set(x, y, c);
    }
  }
}

// Ear: outlined triangle with optional pink inner.
function ear(apex, baseA, baseB, inner) {
  const cx = (apex[0] + baseA[0] + baseB[0]) / 3;
  const cy = (apex[1] + baseA[1] + baseB[1]) / 3;
  const grow = (p) => [p[0] + Math.sign(p[0] - cx) * 1.1, p[1] + Math.sign(p[1] - cy) * 1.1];
  tri(grow(apex), grow(baseA), grow(baseB), OUTLINE);
  tri(apex, baseA, baseB, BODY);
  if (inner) {
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    tri(lerp(apex, cx2(apex, cy), 0.35), lerp(baseA, [cx, cy], 0.45),
        lerp(baseB, [cx, cy], 0.45), PINK);
  }
  function cx2(a) { return [cx, cy]; }
}

// ── Per-frame cat drawing ────────────────────────────────────────────────────
// facing: 'down' | 'side' | 'up'   phase: 0 idle, 1 stepA, 2 stepB
function drawCat(col, row, facing, phase) {
  OFFX = col * FRAME; OFFY = row * FRAME;

  const bob = phase === 0 ? 0 : -1;        // body lifts a touch mid-stride
  const headCY = 12 + bob;
  const bodyCY = 22 + bob;

  // Foot positions — the heart of the walk cue.
  let footL, footR; // each [x, y]
  if (facing === 'side') {
    // back foot (x~10) / front foot (x~21)
    if (phase === 1)      { footL = [9, 28];  footR = [25, 29]; }
    else if (phase === 2) { footL = [14, 29]; footR = [19, 28]; }
    else                  { footL = [11, 29]; footR = [21, 29]; }
  } else {
    // down / up: left foot (x~11) / right foot (x~21)
    if (phase === 1)      { footL = [10, 30]; footR = [21, 27]; }
    else if (phase === 2) { footL = [11, 27]; footR = [22, 30]; }
    else                  { footL = [11, 29]; footR = [21, 29]; }
  }

  // 1) feet (behind body)
  blob(footL[0], footL[1], 2.6, 2.1, SHADE);
  blob(footR[0], footR[1], 2.6, 2.1, SHADE);

  // 2) tail (behind body, side/up only)
  if (facing === 'side') {
    blob(7, 19 + bob, 2.3, 2.3, BODY);
    blob(5, 15 + bob, 2.1, 2.1, BODY);
  } else if (facing === 'up') {
    blob(16, 30, 2.4, 2.0, BODY);
  }

  // 3) body
  blob(16, bodyCY, 8.4, 6.4, BODY);
  if (facing !== 'up') ellipse(16, bodyCY + 1.5, 4.6, 4.2, WHITE); // belly

  // 4) head
  blob(16, headCY, 7.6, 7.2, BODY);

  // 5) ears
  if (facing === 'side') {
    // one ear visible, angled toward front
    ear([22, 1 + bob], [16, 7 + bob], [25, 8 + bob], true);
  } else {
    const innerEars = facing === 'down';
    ear([9, 1 + bob],  [6, 8 + bob],  [14, 7 + bob], innerEars);
    ear([23, 1 + bob], [18, 7 + bob], [26, 8 + bob], innerEars);
  }

  // 6) face
  if (facing === 'down') {
    ellipse(16, headCY + 3, 4.6, 3.6, WHITE);          // muzzle patch
    ellipse(12, headCY - 0.5, 1.7, 2.1, EYE);
    ellipse(20, headCY - 0.5, 1.7, 2.1, EYE);
    set(12, headCY - 1.3, WHITE); set(20, headCY - 1.3, WHITE); // eye glint
    ellipse(16, headCY + 3, 1.3, 1.0, PINK);           // nose
    ellipse(9, headCY + 3, 1.6, 1.1, BLUSH);
    ellipse(23, headCY + 3, 1.6, 1.1, BLUSH);
  } else if (facing === 'side') {
    ellipse(22, headCY + 3, 3.4, 3.0, WHITE);          // muzzle toward front
    ellipse(20, headCY - 0.3, 1.7, 2.1, EYE);
    set(20, headCY - 1.1, WHITE);
    ellipse(24, headCY + 2.6, 1.2, 1.0, PINK);         // nose at snout tip
  }
  // facing === 'up' : back of head, no face details
}

// ── Build the 9 frames ───────────────────────────────────────────────────────
const ROWS = ['down', 'side', 'up'];
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 3; col++) {
    drawCat(col, row, ROWS[row], col);
  }
}

// ── PNG encode ───────────────────────────────────────────────────────────────
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, y * w * 4 + w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = path.join(__dirname, '..', 'world', 'assets');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'mint_kitten_sheet_3x3.png');
fs.writeFileSync(outPath, encodePNG(SHEET, SHEET, px));
console.log('wrote', outPath);
