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
