# Clipboard History

Clipboard history for Windows. It remembers everything you copy (text, links, colors, images).
Press **Ctrl+Shift+V** and the history opens right at your text cursor, **without taking focus** from the
field you're typing in. Click an item and it is pasted there.

Built with Electron 44, React 19 and Vite 8.

## Usage

| Action | What happens |
| --- | --- |
| `Ctrl+Shift+V` | Open the palette at the text cursor (or the mouse pointer) |
| Click an item | Paste it. `Shift`+click pastes as plain text |
| `Ctrl+Shift+V` again | Paste the hovered item (the newest by default) |
| Search button / `Ctrl+F` | Open search: case- and accent-insensitive, Turkish-aware (`sifre` → `Şifre`). Only now does the palette take focus; `↑` `↓` `Enter` work, and focus goes back to your app after pasting |
| Pin / trash buttons | Shown on hover. Pinned items never get trimmed and are listed in the Pinned tab |
| Tabs | All · Pinned · Text · Links · Images |
| `Esc` / click outside | Close |
| Clear history | Footer button, two clicks (keeps pinned items) |
Right-click the tray icon for: pause recording, start with Windows, clear history, and the settings file.

## Development

```bash
npm install
npm run dev     # Vite dev server + Electron with HMR
npm start       # production build, run locally
npm run dist    # Windows installer via electron-builder
```

Data is stored in `%APPDATA%\Clipboard History\` (`history.json`, `images/`, `settings.json`).

## How it works

```
electron/
  main.cjs       tray, global shortcut, palette window, clipboard watcher, paste flow
  winhelper.cjs  long-lived PowerShell process hosting a small C# class (user32 P/Invoke)
  store.cjs      history: dedupe, pinning, size limit, debounced atomic JSON writes
  icon.cjs       tray icon drawn at runtime (anti-aliased SDF), no binary assets
  preload.cjs    narrow contextBridge API
src/
  App.jsx        palette UI: search, filters, list, preview, keyboard handling
  search.js      length-preserving fold + highlight ranges
```

**Change detection.** Electron has no "clipboard changed" event. Instead of reading and comparing the whole
clipboard every few hundred ms (expensive with big screenshots), the app polls Win32's
`GetClipboardSequenceNumber`. It's a single integer, so it costs almost nothing. The clipboard is only read
when that number changes.

**Native features without a native module.** Getting the focused window, sending `Ctrl+V` and finding the
clipboard's owner process all need user32. Instead of a node-gyp module that has to be rebuilt for each
Electron version, one PowerShell process starts with the app and compiles a ~60-line C# class via `Add-Type`.
It then answers line-based commands over stdin/stdout. Startup takes ~1 s and each call takes well under 1 ms.

**Pasting into the previous app.** When the palette opens, the app remembers the foreground window handle.
On Enter it writes the item to the clipboard, hides the palette, restores focus to that window and sends `Ctrl+V`.
Before sending, it waits until Shift is physically released. Otherwise `Shift+Enter` would turn into
`Ctrl+Shift+V` and reopen the palette.

**The palette never steals focus.** It is a non-activating window (`focusable: false` → `WS_EX_NOACTIVATE`),
shown with `showInactive()` at the text caret (`GetGUIThreadInfo`). The text field you were typing in keeps its
focus and caret, so the palette is mouse-only and pasting needs no focus juggling. `Esc` and `Ctrl+F` are
registered as global shortcuts only while the palette is open. A non-activating window never gets a blur event,
so the helper runs a low-level mouse hook while the palette is open. The hook only observes, never blocks, and
closes the palette on a click outside it. Search is opt-in: it's the one moment the palette takes focus. When
the palette closes, focus is handed back to the original window (`AttachThreadInput` gets around Windows'
foreground lock) before the palette hides.
**Privacy: password managers.** There are two layers:
1. Windows' own convention: password managers mark sensitive copies with clipboard formats such as
   `ExcludeClipboardContentFromMonitorProcessing` and `CanIncludeInClipboardHistory = 0`. Windows' built-in
   Win+V history honours these, and so does this app.
2. A fallback for apps that don't follow the convention: the process that owns the clipboard
   (`GetClipboardOwner`) is checked against an ignore list (KeePass, 1Password, Bitwarden, …). You can edit
   the list in `settings.json`.

Pause recording from the tray at any time. Everything stays local; nothing leaves the machine.

**Search.** `fold()` maps every UTF-16 unit to exactly one unit (lowercase, accents removed, `İ/I/ı → i`).
Match indices in the folded string are therefore also valid in the original string, which makes highlighting
trivial. A plain `toLowerCase()` would break this, because `'İ'.toLowerCase()` is two characters long.
