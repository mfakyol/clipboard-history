// Generates README screenshots: the palette in light and dark themes (transparent background).
// Usage: npm run build && npm run screenshot
// Output: docs/screenshots/light.png, docs/screenshots/dark.png
const { app, BrowserWindow, nativeTheme } = require('electron')
const fs = require('fs')
const path = require('path')
const { ROOT, writeMockPage } = require('./mock-ui.cjs')
const { registerScheme, serveDemoImages } = require('./demo-image.cjs')

const OUT_DIR = path.join(ROOT, 'docs', 'screenshots')
// Each theme previews a different item: the image in light, the multi-line text in dark.
const SHOTS = [
  { theme: 'light', hover: 1 },
  { theme: 'dark', hover: 3 },
]

registerScheme()

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const guard = setTimeout(() => {
    console.error('timed out')
    app.exit(2)
  }, 60_000)

  serveDemoImages()
  const page = writeMockPage('_shot.html')
  await new Promise((r) => setTimeout(r, 300)) // sync tools like OneDrive can briefly lock a new file

  // capturePage needs a visible window; it briefly appears on screen. Same size as the real palette.
  const win = new BrowserWindow({
    width: 820,
    height: 540,
    x: 0,
    y: 0,
    show: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  })

  try {
    for (const { theme, hover } of SHOTS) {
      nativeTheme.themeSource = theme
      await win.loadFile(page)
      await new Promise((r) => setTimeout(r, 700))
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.row')[${hover}].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 2 })); true`
      )
      await new Promise((r) => setTimeout(r, 400))
      const file = path.join(OUT_DIR, `${theme}.png`)
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG())
      console.log('wrote:', path.relative(ROOT, file), `${Math.round(fs.statSync(file).size / 1024)} KB`)
    }
    win.destroy()
  } catch (err) {
    console.error('error:', err)
    app.exit(1)
  } finally {
    fs.rmSync(page, { force: true })
  }
  clearTimeout(guard)
  app.quit()
})
