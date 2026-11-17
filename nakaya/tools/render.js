// Grows crystals in Node and writes PNGs, for tuning by eye.
//   node nakaya/tools/render.js out.png T s [steps] [R]          one climate held for the whole fall
//   node nakaya/tools/render.js out.png anchor <name> [steps] [R] one anchor parameter set (prism, plate, ...)
//   node nakaya/tools/render.js out.png sky "T,s;T,s;..." [steps] [R]  waypoints spread over the fall
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const SNOW = require(path.join(__dirname, "..", "snow.js"));

function crcTable() { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; }
const CRC = crcTable();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Draw the crystal: thickness as brightness, birth time as a hue band, scaled to fill the image.
function draw(cr, size) {
  const L = cr.L, R = L.R, N = L.N, img = Buffer.alloc(size * size * 3);
  const ext = Math.max(4, cr.extent + 2), sq3 = Math.sqrt(3);
  let cmax = 0; for (let i = 0; i < L.n; i++) if (cr.a[i] && cr.c[i] > cmax) cmax = cr.c[i];
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = (px / size * 2 - 1) * ext, y = (py / size * 2 - 1) * ext;
    const rr = y * 2 / sq3, qq = x - rr / 2;
    let cx = qq, cz = rr, cy = -cx - cz, rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
    const dx = Math.abs(rx - cx), dy = Math.abs(ry - cy), dz = Math.abs(rz - cz);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
    const o = (py * size + px) * 3;
    img[o] = 10; img[o + 1] = 16; img[o + 2] = 32;
    if (SNOW.hexDist(rx, rz) > R) continue;
    const k = L.full[(rx + R) * N + (rz + R)];
    if (k < 0) continue;
    if (cr.a[k]) {
      const v = Math.min(1, cr.c[k] / cmax), t = cr.born[k] / Math.max(1, cr.t);
      img[o] = 60 + 195 * v * (0.6 + 0.4 * t); img[o + 1] = 80 + 175 * v; img[o + 2] = 120 + 135 * v * (1 - 0.4 * t);
    } else if (cr.inFront[k]) { img[o] = 40; img[o + 1] = 50; img[o + 2] = 90; }
  }
  return img;
}

module.exports = { png, draw };
if (require.main === module) main();
function main() {
const [out, a1, a2, a3, a4] = process.argv.slice(2);
let steps = 6000, R = 160, sky;
if (a1 === "anchor") {
  steps = +(a3 || steps); R = +(a4 || R);
  const v = SNOW.ANCHORS[a2], p = {}; SNOW.KEYS.forEach((k, i) => p[k] = v[i]);
  const cr = new SNOW.Crystal({ R, seed: 1 }); cr.seed(p);
  const t0 = Date.now();
  while (cr.t < steps && cr.extent < R * 0.86) cr.step();
  console.log(a2, "steps", cr.t, "extent", cr.extent, "ms", Date.now() - t0);
  fs.writeFileSync(out, png(400, 400, draw(cr, 400)));
  return;
}
if (a1 === "sky") {
  steps = +(a3 || steps); R = +(a4 || R);
  sky = SNOW.skyFromWaypoints(a2.split(";").map((w) => w.split(",").map(Number)), steps);
} else {
  steps = +(a3 || steps); R = +(a4 || R);
  sky = SNOW.skyFromWaypoints([[+a1, +a2]], steps);
}
const t0 = Date.now();
const cr = SNOW.grow(sky, { R, seed: 1 });
console.log("steps", cr.t, "extent", cr.extent, "of", R, "front", cr.front.length, "ms", Date.now() - t0, "climate", JSON.stringify(SNOW.climate(sky[0][0], sky[0][1])));
fs.writeFileSync(out, png(400, 400, draw(cr, 400)));
}
