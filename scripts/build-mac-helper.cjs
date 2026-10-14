// Compiles electron/mac/ClipHelper.swift into a universal (arm64 + x86_64) binary at build/mac/clip-helper.
// electron-builder copies it into the app's Resources (extraResources in electron-builder.yml).
// Needs the Xcode command line tools (xcode-select --install).
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const src = path.join(ROOT, 'electron', 'mac', 'ClipHelper.swift')
const outDir = path.join(ROOT, 'build', 'mac')
const out = path.join(outDir, 'clip-helper')

if (process.platform !== 'darwin') {
  console.log('build-mac-helper: not on macOS, skipped')
  process.exit(0)
}

// npm run dev passes --if-stale: skip when the binary is newer than the source
if (process.argv.includes('--if-stale') && fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) {
  process.exit(0)
}

fs.mkdirSync(outDir, { recursive: true })
const slices = ['arm64', 'x86_64'].map((arch) => {
  const file = path.join(outDir, `clip-helper-${arch}`)
  execFileSync('swiftc', ['-O', '-target', `${arch}-apple-macos12`, '-o', file, src], { stdio: 'inherit' })
  return file
})
execFileSync('lipo', ['-create', '-output', out, ...slices], { stdio: 'inherit' })
slices.forEach((f) => fs.rmSync(f))
execFileSync('codesign', ['--force', '--sign', '-', out], { stdio: 'inherit' })
console.log('built: ' + path.relative(ROOT, out))
