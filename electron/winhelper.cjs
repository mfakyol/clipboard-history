// A long-lived PowerShell process hosting a tiny C# class that talks to user32.
// It gives us the Win32 bits Electron doesn't expose, without a native module:
//   seq        -> clipboard sequence number (cheap change detection)
//   fg         -> HWND of the foreground window (to restore focus before pasting)
//   info       -> "<hidden 0|1>|<process that owns the clipboard>"
//   caret      -> "x,y,height" of the foreground app's text caret (physical px), or "none"
//   focusrect  -> "x,y,w,h" of the focused UI element via UI Automation (physical px), or "none"
//   focus <h>  -> give focus back to window <h>
//   paste <h>  -> focus window <h>, wait for modifiers to be released, send Ctrl+V
//   watch 1|0  -> report mouse clicks while the palette is open (see ClickWatch)
// Protocol: one command line in, exactly one response line out. Lines starting with "!" are
// unsolicited events:
//   !m <x> <y>  mouse button pressed while watching (physical px)

const { spawn } = require('child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class ClipHelper {
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll")] public static extern IntPtr GetClipboardOwner();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint format);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO info);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public int cbSize, flags;
    public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
    public RECT rcCaret;
  }

  const uint KEYUP = 2;
  static readonly uint[] HiddenFormats = {
    RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing"),
    RegisterClipboardFormat("Clipboard Viewer Ignore")
  };

  public static string ProcessOf(IntPtr h) {
    if (h == IntPtr.Zero) return "";
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
  }

  public static string Info() {
    bool hidden = false;
    foreach (uint f in HiddenFormats) if (f != 0 && IsClipboardFormatAvailable(f)) hidden = true;
    IntPtr owner = GetClipboardOwner();
    if (owner == IntPtr.Zero) owner = GetForegroundWindow();
    return (hidden ? "1" : "0") + "|" + ProcessOf(owner);
  }

  // Text caret of the foreground app in physical screen pixels: "x,y,height", or "none".
  // Works for apps that keep a system caret (Win32, WinForms, WPF, Chromium/Electron do for a11y).
  public static string Caret() {
    SetThreadDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: no DPI virtualization
    IntPtr fg = GetForegroundWindow();
    if (fg == IntPtr.Zero) return "none";
    uint pid;
    uint tid = GetWindowThreadProcessId(fg, out pid);
    GUITHREADINFO info = new GUITHREADINFO();
    info.cbSize = Marshal.SizeOf(info);
    if (!GetGUIThreadInfo(tid, ref info) || info.hwndCaret == IntPtr.Zero) return "none";
    POINT p = new POINT();
    p.X = info.rcCaret.Left;
    p.Y = info.rcCaret.Top;
    if (!ClientToScreen(info.hwndCaret, ref p)) return "none";
    return p.X + "," + p.Y + "," + (info.rcCaret.Bottom - info.rcCaret.Top);
  }

  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

  // Windows only lets the foreground process hand out focus ("foreground lock"); a plain
  // SetForegroundWindow from this helper silently fails and Windows activates whatever is next
  // in z-order instead (often the browser). Joining the foreground thread's input queue lifts
  // the lock; a synthetic Alt tap is the fallback.
  public static bool Focus(long hwnd) {
    IntPtr h = new IntPtr(hwnd);
    if (h == IntPtr.Zero || !IsWindow(h)) return false;
    if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
    if (GetForegroundWindow() == h) return true;

    uint pid;
    uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint me = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fgThread, false);

    if (GetForegroundWindow() != h) {
      keybd_event(0x12, 0, 0, UIntPtr.Zero);
      keybd_event(0x12, 0, KEYUP, UIntPtr.Zero);
      SetForegroundWindow(h);
    }
    return GetForegroundWindow() == h;
  }

  // Bounding box of the focused UI element (the input/textarea you're in) via UI Automation, in
  // physical pixels: "x,y,w,h", or "none". Works in browsers, where there's often no system caret.
  // UIA can be slow (a browser builds its accessibility tree on first use), so it's capped.
  public static string FocusRect() {
    System.Threading.Tasks.Task<string> task = System.Threading.Tasks.Task.Run(() => {
      SetThreadDpiAwarenessContext(new IntPtr(-4));
      System.Windows.Automation.AutomationElement el = System.Windows.Automation.AutomationElement.FocusedElement;
      if (el == null) return "none";
      System.Windows.Rect r = el.Current.BoundingRectangle;
      if (r.IsEmpty || r.Width <= 0 || r.Height <= 0 || double.IsInfinity(r.Width)) return "none";
      return (int)r.Left + "," + (int)r.Top + "," + (int)r.Width + "," + (int)r.Height;
    });
    try { return task.Wait(400) ? task.Result : "none"; } catch { return "none"; }
  }

  static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

  public static void Paste(long hwnd) {
    Focus(hwnd);
    // Shift held from Shift+Enter would turn this into Ctrl+Shift+V and reopen the palette.
    for (int i = 0; i < 150 &&(Down(0x10) || Down(0x11) || Down(0x12) || Down(0x5B) || Down(0x5C)); i++) Thread.Sleep(10);
    Thread.Sleep(40);
    keybd_event(0x11, 0, 0, UIntPtr.Zero);
    keybd_event(0x56, 0, 0, UIntPtr.Zero);
    keybd_event(0x56, 0, KEYUP, UIntPtr.Zero);
    keybd_event(0x11, 0, KEYUP, UIntPtr.Zero);
  }
}

// The palette doesn't take focus, so it never sees a "blur" when you click elsewhere. While it's
// open, a low-level mouse hook reports clicks (it never blocks them) so main can close the palette
// on a click outside it. No keyboard hook: keys always go to the app you're typing in.
public static class ClickWatch {
  delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)] struct MSLLHOOKSTRUCT { public int x, y; public uint mouseData, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }

  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);

  public static volatile bool Watching;
  static readonly HookProc msProc = MouseProc; // held in a static so the GC can't collect it
  static readonly object outLock = new object();

  public static void Send(string line) { lock (outLock) { Console.Out.WriteLine(line); } }

  public static void Start() {
    Thread t = new Thread(() => {
      SetThreadDpiAwarenessContext(new IntPtr(-4)); // mouse coordinates in physical pixels
      SetWindowsHookEx(14, msProc, GetModuleHandle(null), 0); // WH_MOUSE_LL
      MSG m;
      while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
    });
    t.IsBackground = true;
    t.Start();
  }

  static IntPtr MouseProc(int code, IntPtr w, IntPtr l) {
    if (code >= 0 && Watching) {
      int msg = w.ToInt32();
      if (msg == 0x201 || msg == 0x204 || msg == 0x207) { // L/R/M button down
        MSLLHOOKSTRUCT m = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(l, typeof(MSLLHOOKSTRUCT));
        Send("!m " + m.x + " " + m.y);
      }
    }
    return CallNextHookEx(IntPtr.Zero, code, w, l);
  }
}
'@
try { [ClickWatch]::Start() } catch { }
[ClickWatch]::Send('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $parts = $line.Trim().Split(' ')
  try {
    switch ($parts[0]) {
      'seq'   { $r = [ClipHelper]::GetClipboardSequenceNumber() }
      'fg'    { $r = [ClipHelper]::GetForegroundWindow().ToInt64() }
      'info'  { $r = [ClipHelper]::Info() }
      'caret' { $r = [ClipHelper]::Caret() }
      'focusrect' { $r = [ClipHelper]::FocusRect() }
      'focus' { $r = [ClipHelper]::Focus([long]$parts[1]) }
      'paste' { [ClipHelper]::Paste([long]$parts[1]); $r = 'ok' }
      'watch' { [ClickWatch]::Watching = ($parts[1] -eq '1'); $r = 'ok' }
      default { $r = 'unknown' }
    }
  } catch { $r = 'error' }
  [ClickWatch]::Send([string]$r)
}
`;

class WinHelper {
  constructor() {
    this.ready = false;
    this.onEvent = () => {};
    this.pending = [];
    this.buffer = '';
    this.proc = null;
  }

  start(timeoutMs = 15000) {
    if (process.platform !== 'win32') return Promise.resolve(false);
    return new Promise((resolve) => {
      const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
      this.proc = spawn(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      );

      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.proc.stdout.setEncoding('utf8');
      this.proc.stdout.on('data', (chunk) => {
        this.buffer += chunk;
        let nl;
        while ((nl = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, nl).replace(/\r$/, '');
          this.buffer = this.buffer.slice(nl + 1);
          if (!this.ready) {
            if (line === 'ready') {
              this.ready = true;
              clearTimeout(timer);
              resolve(true);
            }
            continue;
          }
          if (line.startsWith('!')) {
            this.onEvent(line.slice(1).split(' '));
            continue;
          }
          const next = this.pending.shift();
          if (next) next.resolve(line);
        }
      });
      this.proc.stderr.on('data', (d) => {
        const text = String(d).trim();
        if (text && !text.includes('CLIXML') && !text.startsWith('<Objs')) console.error('[winhelper]', text);
      });
      this.proc.on('exit', () => {
        this.ready = false;
        clearTimeout(timer);
        resolve(false);
        for (const p of this.pending.splice(0)) p.reject(new Error('helper exited'));
      });
      this.proc.on('error', () => resolve(false));
    });
  }

  cmd(line) {
    if (!this.ready) return Promise.reject(new Error('helper not ready'));
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.proc.stdin.write(line + '\n');
    });
  }

  stop() {
    if (this.proc) {
      this.proc.stdin.end();
      this.proc.kill();
    }
  }
}

module.exports = { WinHelper };
