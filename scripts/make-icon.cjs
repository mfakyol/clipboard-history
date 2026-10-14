// Generates the 256x256 app icon (resources/icon.png) with no external dependencies:
// a white clipboard on an indigo rounded square, anti-aliased with signed distance fields.
// Same glyph as the tray icon drawn at runtime in electron/icon.cjs.
const fs = require('fs')
const zlib = require('zlib')
const path = require('path')

const SIZE = 256
const S = SIZE / 32 // the glyph is designed on a 32px grid

function roundRectDistance(px, py, [x0, y0, x1, y1], r) {
  const qx = Math.abs(px - (x0 + x1) / 2) - ((x1 - x0) / 2 - r)
  const qy = Math.abs(py - (y0 + y1) / 2) - ((y1 - y0) / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

const grid = (rect, r, color) => ({ rect: rect.map((v) => v * S), r: r * S, color })
const layers = [
  { rect: [0, 0, SIZE, SIZE], r: 56, color: [99, 102, 241] }, // background tile
  grid([7.5, 7, 24.5, 28.5], 3, [255, 255, 255]), // board
  grid([11.5, 4.5, 20.5, 10], 2, [199, 210, 254]), // clip
  grid([11, 14, 21, 15.75], 0.875, [99, 102, 241]), // text lines
  grid([11, 18, 21, 19.75], 0.875, [99, 102, 241]),
  grid([11, 22, 17.5, 23.75], 0.875, [99, 102, 241]),
]

const px = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0 // premultiplied
    for (const layer of layers) {
      const cov = Math.min(1, Math.max(0, 0.5 - roundRectDistance(x + 0.5, y + 0.5, layer.rect, layer.r)))
      if (!cov) continue
      r = layer.color[0] * cov + r * (1 - cov)
      g = layer.color[1] * cov + g * (1 - cov)
      b = layer.color[2] * cov + b * (1 - cov)
      a = 255 * cov + a * (1 - cov)
    }
    const o = (y * SIZE + x) * 4
    // PNG wants straight (non-premultiplied) alpha
    px[o] = a ? Math.round((r * 255) / a) : 0
    px[o + 1] = a ? Math.round((g * 255) / a) : 0
    px[o + 2] = a ? Math.round((b * 255) / a) : 0
    px[o + 3] = Math.round(a)
  }
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const crcTable = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])
const out = path.join(__dirname, '..', 'resources', 'icon.png')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, png)
console.log('icon written:', out)
