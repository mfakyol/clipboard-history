// Generates the README demo GIF: the real palette (built renderer + mock data) inside a fake
// notes editor. Pastes a link, an image and (through search) a code snippet.
// Usage: npm run build && npm run demo
// Output: docs/demo.gif   (DEMO_FRAMES=<dir> also dumps every frame as PNG for review)
const { app, BrowserWindow, nativeTheme } = require('electron')
const fs = require('fs')
const path = require('path')
const { GIFEncoder, quantize, applyPalette } = require('gifenc')
const { ROOT, writePage, writeMockPage } = require('./mock-ui.cjs')
const { sceneHtml } = require('./demo-scene.cjs')
const { registerScheme, serveDemoImages } = require('./demo-image.cjs')

const OUT = path.join(ROOT, 'docs', 'demo.gif')
const WIDTH = 1180
const HEIGHT = 900
/** GIF width; scaled down to keep the file size reasonable */
const GIF_WIDTH = 960

// Helpers injected into the palette iframe: find targets, hover, click, type, press Enter.
const PALETTE_HELPERS = `
window.__find = (sel, index) => document.querySelectorAll(sel)[index || 0] || null;
window.__rect = (sel, index) => {
  const el = window.__find(sel, index);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
window.__hover = (sel, index) => {
  const el = window.__find(sel, index);
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 2, movementY: 1 }));
  return true;
};
window.__click = (sel, index) => {
  const el = window.__find(sel, index);
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  return true;
};
window.__type = (ch) => {
  const input = document.querySelector('.search input');
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, input.value + ch);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};
window.__enter = () => {
  const input = document.querySelector('.search input');
  if (!input) return false;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  return true;
};
true;
`

// Click ring drawn on the scene (above the iframe) at scene coordinates.
const RING = `
window.__ring = (x, y) => {
  const ring = document.createElement('div');
  ring.id = '__ring';
  const size = 34;
  Object.assign(ring.style, {
    position: 'fixed', zIndex: 99999, pointerEvents: 'none',
    left: (x - size / 2) + 'px', top: (y - size / 2) + 'px', width: size + 'px', height: size + 'px',
    borderRadius: '50%', background: 'rgba(129,140,248,0.25)', border: '3px solid rgba(129,140,248,0.95)'
  });
  document.body.appendChild(ring);
  return true;
};
window.__unring = () => (document.getElementById('__ring')?.remove(), true);
window.__frameOrigin = () => {
  const r = document.querySelector('iframe').getBoundingClientRect();
  return { x: r.left, y: r.top };
};
true;
`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Captures one frame from the window: downscaled RGBA pixel array */
async function grab(win) {
  const img = (await win.webContents.capturePage()).resize({ width: GIF_WIDTH, quality: 'best' })
  const { width, height } = img.getSize()
  const bgra = img.toBitmap() // BGRA on Windows
  const rgba = new Uint8Array(bgra.length)
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]
    rgba[i + 1] = bgra[i + 1]
    rgba[i + 2] = bgra[i]
    rgba[i + 3] = 255
  }
  return { rgba, width, height }
}

registerScheme()

app.whenReady().then(async () => {
  const guard = setTimeout(() => {
    console.error('timed out')
    app.exit(2)
  }, 120_000)

  nativeTheme.themeSource = 'dark'
  serveDemoImages()
  const palettePage = writeMockPage('_demo-palette.html')
  const scenePage = writePage('_demo-scene.html', sceneHtml('_demo-palette.html'))
  await sleep(300) // sync tools like OneDrive can briefly lock a new file

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: 0,
    y: 0,
    show: true,
    frame: false,
    useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  })

  const frames = []
  const dumpDir = process.env.DEMO_FRAMES
  if (dumpDir) fs.mkdirSync(dumpDir, { recursive: true })
  const add = async (delay) => {
    const f = await grab(win)
    frames.push({ ...f, delay })
    if (dumpDir) {
      const png = (await win.webContents.capturePage()).resize({ width: GIF_WIDTH }).toPNG()
      fs.writeFileSync(path.join(dumpDir, `frame-${String(frames.length).padStart(2, '0')}.png`), png)
    }
  }
  const scene = (code) => win.webContents.executeJavaScript(code)
  const palette = (code) => win.webContents.mainFrame.frames[0].executeJavaScript(code)
  const must = async (result, what) => {
    if (!(await result)) throw new Error('step failed: ' + what)
  }

  // Ring on a palette element, capture, then click it
  const clickInPalette = async (sel, index = 0, hold = 1200) => {
    const r = await palette(`window.__rect(${JSON.stringify(sel)}, ${index})`)
    if (!r) throw new Error('not found: ' + sel)
    const o = await scene('window.__frameOrigin()')
    await palette(`window.__hover(${JSON.stringify(sel)}, ${index})`)
    await scene(`window.__ring(${o.x + r.x}, ${o.y + r.y})`)
    await sleep(150)
    await add(500)
    await scene('window.__unring()')
    await must(palette(`window.__click(${JSON.stringify(sel)}, ${index})`), 'click ' + sel)
    await sleep(350)
    await add(hold)
  }
  const openPalette = async (hold = 1300) => {
    await scene('window.__keys(true)')
    await add(500)
    await must(scene('window.__open()'), 'open palette')
    await sleep(450)
    await add(hold)
    await scene('window.__keys(false)')
  }

  try {
    await win.loadFile(scenePage)
    await sleep(1200)
    await scene(RING)
    await palette(PALETTE_HELPERS)

    // 1) Link: palette opens right under the caret, newest item first
    await add(1400)
    await openPalette()
    await clickInPalette('.row', 0, 1300)
    console.log('scene 1: link')

    // 2) Image: hover shows the preview, click drops it into the document
    await scene('window.__newLine()')
    await openPalette(1000)
    await palette(`window.__hover('.row', 1)`)
    await sleep(250)
    await add(1300)
    await clickInPalette('.row', 1, 1500)
    console.log('scene 2: image')

    // 3) Search: opt-in, type "deb", Enter pastes the snippet
    await openPalette(900)
    await clickInPalette('.search-btn', 0, 700)
    for (const ch of 'deb') {
      await palette(`window.__type(${JSON.stringify(ch)})`)
      await sleep(120)
      await add(260)
    }
    await add(1200)
    await must(palette('window.__enter()'), 'enter')
    await sleep(400)
    await add(2600)
    console.log('scene 3: search')

    win.destroy()

    // Encode: each frame with its own 256-color palette
    const gif = GIFEncoder()
    for (const f of frames) {
      const pal = quantize(f.rgba, 256)
      const index = applyPalette(f.rgba, pal)
      gif.writeFrame(index, f.width, f.height, { palette: pal, delay: f.delay })
    }
    gif.finish()
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, gif.bytes())
    const total = frames.reduce((s, f) => s + f.delay, 0)
    console.log(
      `wrote: ${path.relative(ROOT, OUT)} ${Math.round(fs.statSync(OUT).size / 1024)} KB, ` +
        `${frames.length} frames, ${(total / 1000).toFixed(1)} s, ${frames[0].width}x${frames[0].height}`
    )
  } catch (err) {
    console.error('error:', err)
    app.exit(1)
  } finally {
    fs.rmSync(palettePage, { force: true })
    fs.rmSync(scenePage, { force: true })
  }
  clearTimeout(guard)
  app.quit()
})
