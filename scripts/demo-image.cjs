// A made-up "screenshot" for the mock history (a small bar chart), served over the app's
// clipimg:// scheme so the real <img src="clipimg://img/..."> tags in the renderer work unchanged.
const { nativeImage, protocol } = require('electron')

function drawChart(width = 1280, height = 720) {
  const buf = Buffer.alloc(width * height * 4)
  const fill = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
        const i = (y * width + x) * 4
        buf[i] = b
        buf[i + 1] = g
        buf[i + 2] = r
        buf[i + 3] = 255
      }
    }
  }
  fill(0, 0, width, height, [248, 250, 252]) // page
  fill(0, 0, width, 72, [255, 255, 255]) // header
  fill(0, 72, width, 74, [226, 232, 240])
  fill(48, 26, 220, 46, [30, 41, 59]) // title block
  fill(240, 30, 360, 42, [148, 163, 184])
  fill(64, 120, 1216, 660, [255, 255, 255]) // chart card
  fill(64, 120, 1216, 122, [226, 232, 240])
  fill(104, 160, 280, 178, [51, 65, 85]) // card title
  fill(104, 190, 200, 200, [148, 163, 184])
  for (let i = 0; i <= 4; i++) fill(104, 300 + i * 80, 1176, 302 + i * 80, [241, 245, 249]) // grid
  const bars = [0.38, 0.44, 0.41, 0.52, 0.49, 0.58, 0.63, 0.71, 0.69, 0.82, 0.88, 0.96]
  bars.forEach((h, i) => {
    const x = 128 + i * 88
    const top = 620 - Math.round(h * 300)
    const color = i >= 8 ? [99, 102, 241] : [165, 180, 252]
    fill(x, top, x + 52, 620, color)
  })
  fill(104, 620, 1176, 622, [203, 213, 225]) // axis
  return nativeImage.createFromBitmap(buf, { width, height })
}

let png = null
const demoPng = () => (png ||= drawChart().toPNG())

// Call before app 'ready'
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'clipimg', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ])
}

// Call after app 'ready': every clipimg:// request gets the demo chart
function serveDemoImages() {
  protocol.handle('clipimg', () => new Response(demoPng(), { headers: { 'content-type': 'image/png' } }))
}

module.exports = { registerScheme, serveDemoImages }
