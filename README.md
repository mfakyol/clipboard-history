# Clipboard History

[![Latest release](https://img.shields.io/github/v/release/mfakyol/clipboard-history?label=release&color=6366f1)](https://github.com/mfakyol/clipboard-history/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-0078d4)](https://github.com/mfakyol/clipboard-history/releases/latest)
[![License](https://img.shields.io/github/license/mfakyol/clipboard-history?color=64748b)](LICENSE)

Clipboard history for Windows. It remembers everything you copy, and `Ctrl+Shift+V` opens it right under the field you're typing in, without taking focus from it. Click an item and it's pasted there.

**[⬇ Download for Windows](https://github.com/mfakyol/clipboard-history/releases/latest)**

![Pasting a link, a screenshot and a searched code snippet into a notes editor](docs/demo.gif)

| Light theme | Dark theme |
|---|---|
| ![History palette, light theme](docs/screenshots/light.png) | ![History palette, dark theme](docs/screenshots/dark.png) |

## Features

- **Opens where you type:** right under the focused field or the text cursor, in browsers too
- **Never steals focus:** the field you're typing in keeps its focus and caret
- **One click to paste:** `Shift`+click pastes plain text without formatting
- **Text, links, colors and images:** links show their domain, color codes a swatch, screenshots a preview
- **Search on demand:** ignores case and accents and handles Turkish letters (`sifre` finds `Şifre`)
- **Pinned items:** never removed when the history fills up, and kept in their own tab
- **Private:** copies from password managers are never saved, and nothing leaves your computer
- **Runs in the tray:** starts with Windows, and recording can be paused at any time

## Tech stack

| Area | Technology |
|---|---|
| Desktop runtime | Electron 44: non-activating window, tray, global shortcuts |
| Interface | React 19 |
| Build | Vite 8 |
| Windows integration | PowerShell helper hosting C# (Win32, UI Automation), no native modules |
| Packaging | electron-builder (NSIS installer) |

## Getting started

1. Download and run the installer. It is unsigned, so on first run choose **More info → Run anyway** in the SmartScreen prompt.
2. Copy things as usual: text, links, screenshots (`Win+Shift+S`).
3. Click into any text field and press `Ctrl+Shift+V`, then click an item to paste it.
4. Right-click the tray icon and turn on **Start with Windows**.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+V` | Open the history |
| `Ctrl+Shift+V` twice | Paste the newest item |
| `Ctrl+F` | Search (`↑` `↓` to select, `Enter` to paste) |
| `Esc` | Close |

## Settings

Pause recording, start with Windows and clear history are in the tray menu. The shortcut, the history size and the apps to ignore can be changed in `%APPDATA%\Clipboard History\settings.json`; choose **Reload settings** in the tray menu afterwards.

## Requirements

Windows 10 or later, 64-bit.

## Building from source

```bash
npm install
npm run dev     # run with hot reload
npm run dist    # build the Windows installer into release/
```

Curious about the internals? See [How it works](docs/how-it-works.md).

## License

[MIT](LICENSE)

---

Made by Fatih Akyol · [fatihakyol.com](https://fatihakyol.com/)
