// Draws the tray icon at runtime (anti-aliased clipboard glyph), so the repo needs no binary assets.
const { nativeImage } = require('electron');

function roundRectDistance(px, py, [x0, y0, x1, y1], r) {
  const qx = Math.abs(px - (x0 + x1) / 2) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(py - (y0 + y1) / 2) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function createTrayIcon({ paused = false } = {}) {
  const size = 32;
  const board = paused ? [148, 163, 184] : [99, 102, 241];
  const layers = [
    { rect: [5, 5, 27, 31], r: 4.5, color: board },
    { rect: [10.5, 2, 21.5, 9], r: 2.5, color: [224, 231, 255] },
    { rect: [10, 14, 22, 16.5], r: 1.25, color: [255, 255, 255] },
    { rect: [10, 19.5, 22, 22], r: 1.25, color: [255, 255, 255] },
    { rect: [10, 25, 17.5, 27.5], r: 1.25, color: [255, 255, 255] },
  ];

  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0; // premultiplied
      for (const layer of layers) {
        const cov = Math.min(1, Math.max(0, 0.5 - roundRectDistance(x + 0.5, y + 0.5, layer.rect, layer.r)));
        if (!cov) continue;
        r = layer.color[0] * cov + r * (1 - cov);
        g = layer.color[1] * cov + g * (1 - cov);
        b = layer.color[2] * cov + b * (1 - cov);
        a = 255 * cov + a * (1 - cov);
      }
      const i = (y * size + x) * 4;
      buf[i] = Math.round(b);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(r);
      buf[i + 3] = Math.round(a);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
}

module.exports = { createTrayIcon };
