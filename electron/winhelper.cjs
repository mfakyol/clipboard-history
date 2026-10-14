// A long-lived PowerShell process that compiles winhelper.cs (Add-Type) and talks to user32.
// It gives us the Win32 bits Electron doesn't expose, without a native module:
//   seq        -> clipboard sequence number (cheap change detection)
//   fg         -> HWND of the foreground window (to restore focus before pasting)
//   info       -> "<hidden 0|1>|<process that owns the clipboard>"
//   caret      -> "x,y,height" of the foreground app's text caret (physical px), or "none"
//   focusrect  -> "x,y,w,h" of the focused UI element via UI Automation (physical px), or "none"
//   focus <h>  -> give focus back to window <h>
//   paste <h>  -> focus window <h>, wait for modifiers to be released, send Ctrl+V
//   watch 1|0  -> report mouse clicks while the palette is open (see ClickWatch)
// On macOS the same protocol is served by a small Swift binary instead (mac/ClipHelper.swift), where
// window handles are app pids.
// Protocol: one command line in, exactly one response line out. Lines starting with "!" are
// unsolicited events:
//   !m <x> <y>  mouse button pressed while watching (physical px)

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// PowerShell can't read inside app.asar, so the packaged app ships this file unpacked
// (asarUnpack in electron-builder.yml) next to the archive.
const CS_FILE = path.join(__dirname, 'winhelper.cs').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase -TypeDefinition ([IO.File]::ReadAllText($env:CLIP_HELPER_CS))
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

  spawnProcess() {
    if (process.platform === 'darwin') {
      const bin = macHelperPath();
      if (!bin) {
        console.error('[winhelper] clip-helper not found; run: node scripts/build-mac-helper.cjs');
        return null;
      }
      return spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    }
    if (process.platform !== 'win32') return null;
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    return spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CLIP_HELPER_CS: CS_FILE } }
    );
  }

  start(timeoutMs = 15000) {
    this.buffer = '';
    this.proc = this.spawnProcess();
    if (!this.proc) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.proc.stdout.setEncoding('utf8');
      const proc = this.proc;
      this.proc.stdout.on('data', (chunk) => {
        if (this.proc !== proc) return;
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
        if (this.proc !== proc) return; // an older helper, replaced by stop() + start()
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
    this.ready = false;
    for (const p of this.pending.splice(0)) p.reject(new Error('helper stopped'));
    if (this.proc) {
      this.proc.stdin.end();
      this.proc.kill();
    }
  }
}

// Packaged: Contents/Resources/clip-helper (extraResources). Development: build/mac/clip-helper.
function macHelperPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'clip-helper'),
    path.join(__dirname, '..', 'build', 'mac', 'clip-helper'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

module.exports = { WinHelper };
