const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  clipboard,
  ClipboardItem,
  nativeImage,
  ipcMain,
  screen,
  protocol,
  net,
  shell,
} = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Store } = require('./store.cjs');
const { WinHelper } = require('./winhelper.cjs');
const { createTrayIcon } = require('./icon.cjs');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const POLL_MS = 300;
const WIN_W = 820;
const WIN_H = 540;

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'clipimg', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win = null;
let tray = null;
let store = null;
const helper = new WinHelper();

let paused = false;
let prevHwnd = '0';
let selfWriteUntil = 0;
let lastSeq = null;
let lastSignature = null;

// ---------- palette window ----------
//
// Two modes:
//  - browse (default): the window is non-activating. The text field you were typing in keeps
//    focus and its caret; the palette is mouse-only (click = paste).
//  - search (opt-in, Search button or Ctrl+F): the palette takes focus for typing; when it closes,
//    focus is handed back to the window it was summoned from.

const PAD = 16; // transparent margin around the card, room for its shadow (body padding)
const SEARCH_SHORTCUT = 'CommandOrControl+F';
let searching = false;

// Without the helper we can't give focus back reliably, so fall back to a normal focused palette.
const browseMode = () => helper.ready;

function createWindow() {
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false, // browse mode: never activated (WS_EX_NOACTIVATE)
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Only a focused palette (search mode / fallback) can blur: the user clicked elsewhere on purpose.
  win.on('blur', () => {
    if (!win.webContents.isDevToolsFocused()) hidePalette();
  });
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      hidePalette();
    }
  });
}

async function showPalette() {
  if (win.isVisible()) return hidePalette({ restoreFocus: true });

  prevHwnd = helper.ready ? await helper.cmd('fg').catch(() => '0') : '0';
  searching = false;
  win.setBounds(await paletteBounds());
  win.webContents.send('palette:show');

  // Esc and Ctrl+F belong to the palette only while it's open; the app underneath gets them back after.
  globalShortcut.register('Escape', () => hidePalette({ restoreFocus: true }));
  globalShortcut.register(SEARCH_SHORTCUT, startSearch);

  if (browseMode()) {
    win.setFocusable(false);
    win.showInactive();
    await helper.cmd('watch 1').catch(() => {});
  } else {
    win.setFocusable(true);
    win.show();
    win.focus();
  }
}

async function startSearch() {
  if (!win.isVisible() || searching) return;
  searching = true;
  globalShortcut.unregister(SEARCH_SHORTCUT); // Ctrl+F inside the search box is just a key now
  if (browseMode()) await helper.cmd('watch 0').catch(() => {}); // focused now: blur handles outside clicks
  win.setFocusable(true);
  win.focus();
  // The hotkey/click came to us, so focus() is normally allowed; if Windows refuses, force it.
  if (!win.isFocused() && helper.ready) {
    await helper.cmd(`focus ${win.getNativeWindowHandle().readBigInt64LE()}`).catch(() => {});
  }
  win.webContents.send('palette:search-mode');
}

// restoreFocus: hand focus back to the window the palette was summoned from (Esc, paste).
// Only needed when the palette had focus (search mode); in browse mode it never left.
// It goes back *before* hiding: while we're foreground the helper may activate the target,
// and Windows never gets the chance to pick some other window from the z-order.
async function hidePalette({ restoreFocus = false } = {}) {
  if (!win || !win.isVisible()) return;
  globalShortcut.unregister('Escape');
  globalShortcut.unregister(SEARCH_SHORTCUT);
  if (helper.ready) await helper.cmd('watch 0').catch(() => {});
  if (restoreFocus && win.isFocused()) await restorePrevFocus();
  searching = false;
  win.hide();
  if (browseMode()) win.setFocusable(false);
}

async function restorePrevFocus() {
  if (!helper.ready || prevHwnd === '0') return;
  await helper.cmd(`focus ${prevHwnd}`).catch(() => {});
}

// Clicks reported by the helper while browsing: a click outside the card closes the palette.
function onHelperEvent([type, x, y]) {
  if (type !== 'm' || !win.isVisible() || searching) return;
  const p = screen.screenToDipPoint({ x: Number(x), y: Number(y) });
  const b = win.getBounds();
  const inside = p.x >= b.x + PAD && p.x < b.x + b.width - PAD && p.y >= b.y + PAD && p.y < b.y + b.height - PAD;
  if (!inside) hidePalette();
}

// Browsing palette has no focus to lose, so "user went elsewhere" = the foreground window changed.
function watchForeground() {
  setInterval(async () => {
    if (!win.isVisible() || searching || !browseMode()) return;
    const fg = await helper.cmd('fg').catch(() => prevHwnd);
    if (fg !== prevHwnd) hidePalette();
  }, 250);
}

const SMALL_FIELD = 160; // DIP; taller focused elements are editors/documents, not input boxes

const parseNums = (reply) => (reply === 'none' ? null : reply.split(',').map(Number));

// Where the palette was summoned, as an anchor box { x, top, bottom } in DIP. In order:
//  1. the focused element (UI Automation) if it's a small field: open right below it;
//  2. the text caret, for big editors where the element's bottom edge is far away;
//  3. the mouse pointer.
async function summonPoint() {
  if (helper.ready) {
    const rect = parseNums(await helper.cmd('focusrect').catch(() => 'none'));
    if (rect && rect.every(Number.isFinite)) {
      const [x, y, w, h] = rect;
      const top = screen.screenToDipPoint({ x, y });
      const bottom = screen.screenToDipPoint({ x: x + w, y: y + h });
      if (bottom.y - top.y <= SMALL_FIELD) return { x: top.x, top: top.y, bottom: bottom.y };
    }

    const caret = parseNums(await helper.cmd('caret').catch(() => 'none'));
    if (caret && caret.every(Number.isFinite)) {
      const [x, y, h] = caret;
      const top = screen.screenToDipPoint({ x, y });
      const bottom = screen.screenToDipPoint({ x, y: y + Math.min(Math.max(h, 0), 80) });
      return { x: top.x, top: top.y, bottom: bottom.y };
    }
  }
  const p = screen.getCursorScreenPoint();
  return { x: p.x, top: p.y, bottom: p.y + 16 };
}

async function paletteBounds() {
  const GAP = 6;

  if (store.settings.position === 'center') {
    const { workArea: wa } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return {
      x: Math.round(wa.x + (wa.width - WIN_W) / 2),
      y: Math.round(wa.y + Math.max(0, (wa.height - WIN_H) * 0.38)),
      width: WIN_W,
      height: WIN_H,
    };
  }

  const at = await summonPoint();
  const { workArea: wa } = screen.getDisplayNearestPoint({ x: Math.round(at.x), y: Math.round(at.top) });
  let x = at.x - PAD;
  let y = at.bottom + GAP - PAD; // below the caret, card's left edge lined up with it
  if (y + WIN_H > wa.y + wa.height) y = at.top - GAP - WIN_H + PAD; // no room: open upwards
  x = Math.min(Math.max(x, wa.x), wa.x + wa.width - WIN_W);
  y = Math.min(Math.max(y, wa.y), wa.y + wa.height - WIN_H);
  return { x: Math.round(x), y: Math.round(y), width: WIN_W, height: WIN_H };
}

// ---------- clipboard watching ----------

const rawFormat = (name) => `electron application/osclipboard;format="${name}"`;

async function hasChanged() {
  if (helper.ready) {
    const seq = await helper.cmd('seq');
    if (seq === lastSeq) return false;
    lastSeq = seq;
    return true;
  }
  const [item] = await clipboard.read();
  const sig = `${item ? item.types.join(',') : ''}|${await clipboard.readText()}`;
  if (sig === lastSignature) return false;
  lastSignature = sig;
  return true;
}

// Electron 44's clipboard is async and Blob-based (W3C style); raw OS formats show up as
// `electron application/osclipboard;format="..."` entries in item.types.
function typeLookup(item) {
  const byLower = new Map(item.types.map((t) => [t.toLowerCase(), t]));
  return (type) => byLower.get(type.toLowerCase());
}

const readBuffer = async (item, type) => Buffer.from(await (await item.getType(type)).arrayBuffer());

// Windows' own convention for "don't record this": password managers set these formats.
async function excludedByFormat(item, find) {
  if (find(rawFormat('ExcludeClipboardContentFromMonitorProcessing'))) return true;
  if (find(rawFormat('Clipboard Viewer Ignore'))) return true;
  const flagType = find(rawFormat('CanIncludeInClipboardHistory'));
  if (!flagType) return false;
  const flag = await readBuffer(item, flagType);
  return flag.length >= 4 && flag.readUInt32LE(0) === 0;
}

async function capture() {
  if (paused || Date.now() < selfWriteUntil) return;

  let hidden = false;
  let owner = '';
  if (helper.ready) {
    const [flag, proc] = (await helper.cmd('info')).split('|');
    hidden = flag === '1';
    owner = proc || '';
  }
  if (hidden || store.isIgnoredApp(owner)) return;

  const [item] = await clipboard.read();
  if (!item) return;
  const find = typeLookup(item);
  if (await excludedByFormat(item, find)) return;

  const textType = find('text/plain');
  const text = textType ? await (await item.getType(textType)).text() : '';
  if (text.trim()) {
    const htmlType = find('text/html');
    const html = htmlType ? await (await item.getType(htmlType)).text() : undefined;
    store.addText(text, html, owner);
    return;
  }

  const pngType = find('image/png');
  if (pngType) {
    const png = await readBuffer(item, pngType);
    const image = nativeImage.createFromBuffer(png);
    if (!image.isEmpty()) store.addImage(image, png, owner);
  }
}

function watchClipboard() {
  const tick = async () => {
    try {
      if (await hasChanged()) await capture();
    } catch (err) {
      console.error('[watch]', err);
    } finally {
      setTimeout(tick, POLL_MS);
    }
  };
  tick();
}

// ---------- paste ----------

async function paste(id, { plain = false } = {}) {
  const item = store.get(id);
  if (!item) return;

  selfWriteUntil = Date.now() + 800;
  if (item.kind === 'image') {
    const png = await fs.promises.readFile(store.imagePath(item.image));
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
  } else if (plain || !item.html) {
    await clipboard.writeText(item.text);
  } else {
    await clipboard.write([new ClipboardItem({ 'text/plain': item.text, 'text/html': item.html })]);
  }
  store.markPasted(id);
  await hidePalette({ restoreFocus: true });
  if (!helper.ready) return;

  // Users may set the shortcut to plain Ctrl+V. A registered hotkey swallows the keystroke
  // system-wide, so the Ctrl+V we synthesize would reopen the palette instead of reaching the
  // target app. Step aside while it's delivered, then take the shortcut back.
  globalShortcut.unregister(store.settings.shortcut);
  try {
    await helper.cmd(`paste ${prevHwnd}`);
  } catch {
    // helper died; nothing more we can do for this paste
  } finally {
    setTimeout(bindShortcut, 250);
  }
}

// ---------- tray ----------

function refreshTray() {
  const accel = store.settings.shortcut.replace('CommandOrControl', 'Ctrl');
  tray.setImage(createTrayIcon({ paused }));
  tray.setToolTip(paused ? 'Clipboard History (paused)' : `Clipboard History — ${accel}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open history\t${accel}`, click: showPalette },
      { type: 'separator' },
      {
        label: 'Pause recording',
        type: 'checkbox',
        checked: paused,
        click: (mi) => {
          paused = mi.checked;
          refreshTray();
        },
      },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked }),
      },
      { label: 'Edit settings (ignored apps, limits)…', click: () => shell.openPath(store.settingsFile) },
      { label: 'Reload settings', click: () => { store.reloadSettings(); registerShortcut(); refreshTray(); } },
      { type: 'separator' },
      { label: 'Clear history (keeps pinned)', click: () => store.clearUnpinned() },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ])
  );
}

// Pressing the shortcut again while the palette is open pastes the selection,
// so a quick double press pastes the latest item.
function onShortcut() {
  if (win.isVisible()) win.webContents.send('palette:paste-selected');
  else showPalette();
}

function bindShortcut() {
  if (globalShortcut.isRegistered(store.settings.shortcut)) return true;
  return globalShortcut.register(store.settings.shortcut, onShortcut);
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  const ok = bindShortcut();
  if (!ok && tray) {
    tray.displayBalloon({
      title: 'Clipboard History',
      content: `${store.settings.shortcut} is used by another app. Change "shortcut" in settings.`,
    });
  }
}

// ---------- ipc ----------

ipcMain.handle('history:get', () => store.list());
ipcMain.handle('history:paste', (_e, id, opts) => paste(id, opts));
ipcMain.handle('history:pin', (_e, id) => store.togglePin(id));
ipcMain.handle('history:remove', (_e, id) => store.remove(id));
ipcMain.handle('history:clear', () => store.clearUnpinned());
ipcMain.on('palette:hide', () => hidePalette({ restoreFocus: true }));
ipcMain.on('palette:search', startSearch);

// ---------- lifecycle ----------

app.on('second-instance', showPalette);

app.whenReady().then(async () => {
  app.setAppUserModelId('com.mfakyol.clipboardhistory');

  store = new Store(app.getPath('userData'), (items) => {
    if (win) win.webContents.send('history:changed', items);
  });

  protocol.handle('clipimg', (req) => {
    const name = path.basename(decodeURIComponent(new URL(req.url).pathname));
    if (!/^[a-f0-9]{40}(_t)?\.png$/.test(name)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(store.imagePath(name)).toString());
  });

  createWindow();
  tray = new Tray(createTrayIcon());
  tray.on('click', showPalette);
  refreshTray();
  registerShortcut();

  helper.onEvent = onHelperEvent;
  await helper.start();
  watchClipboard();
  watchForeground();
});

app.on('window-all-closed', (e) => e.preventDefault());

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  helper.stop();
  if (store) store.flush();
});
