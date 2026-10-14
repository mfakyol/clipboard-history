# Clipboard History

[![Latest release](https://img.shields.io/github/v/release/mfakyol/clipboard-history?label=release&color=6366f1)](https://github.com/mfakyol/clipboard-history/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-0078d4)](https://github.com/mfakyol/clipboard-history/releases/latest)
[![License](https://img.shields.io/github/license/mfakyol/clipboard-history?color=64748b)](LICENSE)

Clipboard history for Windows. It remembers everything you copy (text, links, colors and images). Press `Ctrl+Shift+V` and your history opens right under the field you're typing in, **without taking focus from it**. Click an item and it's pasted there.

**[⬇ Download for Windows](https://github.com/mfakyol/clipboard-history/releases/latest)**

## Features

- **Opens where you are:** right under the focused input, or at the text cursor in editors. It works in browsers too
- **Never steals focus:** the field you're typing in keeps its focus and caret while the history is open
- **One click to paste:** `Shift`+click pastes as plain text, without formatting
- **Text, links, colors and images:** links show their domain, color codes show a swatch, screenshots show a preview
- **Search on demand:** press `Ctrl+F` or the Search button. Search ignores case and accents, and handles Turkish letters (`sifre` finds `Şifre`)
- **Pin what you reuse:** pinned items are never trimmed and have their own tab
- **Private by default:** copies from password managers are never saved, and everything stays on your computer
- **Runs in the tray:** can start with Windows, and recording can be paused at any time

## Tech stack

| Area | Technology |
|---|---|
| Desktop runtime | Electron 44: non-activating window, tray, global shortcuts, async clipboard API |
| Interface | React 19 |
| Build | Vite 8 |
| Windows integration | A long-lived PowerShell helper hosting C# (user32 P/Invoke, UI Automation), no native modules |
| Packaging | electron-builder (NSIS installer) |

## Getting started

1. Download and run the installer. It is unsigned, so on first run choose **More info → Run anyway** in the SmartScreen prompt.
2. Copy a few things as usual: text, a link, a screenshot (`Win+Shift+S`).
3. Click into any text field and press `Ctrl+Shift+V`. Click an item to paste it.
4. Right-click the tray icon to turn on **Start with Windows**.

## Shortcuts and actions

| Action | What happens |
|---|---|
| `Ctrl+Shift+V` | Open the history under the focused field |
| Click an item | Paste it (`Shift`+click: plain text) |
| `Ctrl+Shift+V` again | Paste the hovered item, or the newest one |
| `Ctrl+F` or Search | Search; `↑` `↓` to select, `Enter` to paste |
| `Esc` or click outside | Close |
| Pin / trash buttons | Shown when you hover over an item |
| Clear history | Footer button, click twice. Pinned items are kept |

## Settings

The tray menu has pause recording, start with Windows and clear history. Everything else lives in `%APPDATA%\Clipboard History\settings.json`:

| Key | Default | |
|---|---|---|
| `shortcut` | `CommandOrControl+Shift+V` | Global shortcut that opens the history |
| `position` | `caret` | `caret` opens under the focused field, `center` opens in the middle of the screen |
| `maxItems` | `300` | Unpinned items to keep |
| `ignoredApps` | KeePass, 1Password, Bitwarden, … | Never save copies made in these apps |

After editing, choose **Reload settings** in the tray menu.

## How it works

**Never stealing focus.** The history window is non-activating (`WS_EX_NOACTIVATE`) and is shown with `showInactive()`, so the field you were typing in keeps its focus and caret. Because the target app never loses focus, pasting is just writing the clipboard and sending `Ctrl+V`. `Esc` and `Ctrl+F` are registered as global shortcuts only while the window is open. A non-activating window never gets a blur event, so a low-level mouse hook (observe-only, never blocking) closes it on a click outside. Search is opt-in because it's the one moment the window takes focus. When the window closes, focus is handed back to the original app; `AttachThreadInput` gets around Windows' foreground lock.

**Opening under the focused field.** UI Automation (`AutomationElement.FocusedElement`) gives the bounding box of the focused input, which is what places the window in Chrome, where there is usually no system caret. For large elements such as a code editor, the window is placed under the text caret instead (`GetGUIThreadInfo`). If neither is available, it opens at the mouse pointer.

**Native features without a native module.** Focus, caret position, sending keys and finding the clipboard's owner all need Win32. Instead of a node-gyp module that has to be rebuilt for every Electron version, one PowerShell process starts with the app, compiles a small C# class with `Add-Type` and answers line-based commands over stdin/stdout. Startup takes about a second; each call takes well under a millisecond.

**Cheap change detection.** Electron has no "clipboard changed" event. Instead of reading and comparing the whole clipboard on a timer (expensive with screenshots), the app polls `GetClipboardSequenceNumber`, a single integer, and reads the clipboard only when it changes.

**Privacy.** Password managers mark sensitive copies with the clipboard formats `ExcludeClipboardContentFromMonitorProcessing` and `CanIncludeInClipboardHistory = 0`. Windows' own `Win+V` history honours these, and so does this app. As a fallback for apps that don't set them, the process that owns the clipboard (`GetClipboardOwner`) is checked against `ignoredApps`.

**Search.** `fold()` maps every UTF-16 unit to exactly one unit (lowercase, accents removed, `İ/I/ı → i`). Match positions in the folded text are therefore also valid in the original text, which makes highlighting trivial. A plain `toLowerCase()` would break this, because `'İ'.toLowerCase()` is two characters long.

## Requirements

Windows 10 or later, 64-bit.

## Building from source

```bash
npm install
npm run dev       # run with hot reload
npm run dist      # build the Windows installer into release/
npm run release   # build, tag and publish a GitHub Release (-- --dry for local only)
```

## License

[MIT](LICENSE)

---

Made by Fatih Akyol · [fatihakyol.com](https://fatihakyol.com/)
