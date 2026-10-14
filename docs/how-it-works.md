# How it works

Technical notes on the parts of Clipboard History that aren't obvious from the code.

## Never stealing focus

The history window is non-activating (`WS_EX_NOACTIVATE`) and is shown with `showInactive()`, so the field you were typing in keeps its focus and caret. Because the target app never loses focus, pasting is just writing the clipboard and sending `Ctrl+V`.

`Esc` and `Ctrl+F` are registered as global shortcuts only while the window is open. A non-activating window never gets a blur event, so a low-level mouse hook (observe-only, never blocking) closes it on a click outside.

Search is opt-in because it's the one moment the window takes focus. When the window closes, focus is handed back to the original app; `AttachThreadInput` gets around Windows' foreground lock.

## Opening under the focused field

UI Automation (`AutomationElement.FocusedElement`) gives the bounding box of the focused input, which is what places the window in Chrome, where there is usually no system caret. For large elements such as a code editor, the window is placed under the text caret instead (`GetGUIThreadInfo`). If neither is available, it opens at the mouse pointer.

## Native features without a native module

Focus, caret position, sending keys and finding the clipboard's owner all need Win32. Instead of a node-gyp module that has to be rebuilt for every Electron version, one PowerShell process starts with the app, compiles a small C# class with `Add-Type` and answers line-based commands over stdin/stdout. Startup takes about a second; each call takes well under a millisecond.

## Cheap change detection

Electron has no "clipboard changed" event. Instead of reading and comparing the whole clipboard on a timer (expensive with screenshots), the app polls `GetClipboardSequenceNumber`, a single integer, and reads the clipboard only when it changes.

## Privacy

Password managers mark sensitive copies with the clipboard formats `ExcludeClipboardContentFromMonitorProcessing` and `CanIncludeInClipboardHistory = 0`. Windows' own `Win+V` history honours these, and so does this app. As a fallback for apps that don't set them, the process that owns the clipboard (`GetClipboardOwner`) is checked against `ignoredApps` in the settings.

## Search

`fold()` maps every UTF-16 unit to exactly one unit (lowercase, accents removed, `İ/I/ı → i`). Match positions in the folded text are therefore also valid in the original text, which makes highlighting trivial. A plain `toLowerCase()` would break this, because `'İ'.toLowerCase()` is two characters long.

## macOS

The same line protocol is served by a small Swift program (`electron/mac/ClipHelper.swift`), compiled into a universal binary at build time and shipped in the app's Resources. Window handles become app pids.

- **Never stealing focus:** the palette is an `NSPanel` with the non-activating style (`type: 'panel'`), so clicking it doesn't activate the app. Clicks outside are reported by a global `NSEvent` monitor.
- **Opening under the focused field:** the Accessibility API gives the focused element's frame and, for big editors, the caret (`AXBoundsForRange` on the selected range). Chromium-based apps build their accessibility tree only when asked, which `AXManualAccessibility` does.
- **Pasting:** a synthetic `Cmd+V` via `CGEvent`. Focus is handed back by setting `AXFrontmost` on the target app, because macOS 14+ doesn't let a background process activate another app.
- **Change detection:** `NSPasteboard.changeCount`.
- **Privacy:** password managers mark copies with `org.nspasteboard.ConcealedType` / `TransientType`; those are skipped.

All of this needs the Accessibility permission. macOS caches it per process, so the helper is restarted once the permission is granted. Without it the app still records history and puts the chosen item on the clipboard, but it can't paste it for you and opens the palette at the mouse pointer.

