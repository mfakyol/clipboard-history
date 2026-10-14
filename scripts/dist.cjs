// Builds the installers into release/: the Windows one by default, the macOS DMGs with --mac,
// both with --win --mac (the DMGs need a Mac; the Windows installer cross-builds there too).
// electron-builder stages the app in a temp folder outside the project: inside a OneDrive-synced
// folder, its "win-unpacked.tmp -> win-unpacked" rename fails with EPERM because the sync client
// (or the antivirus) still holds the freshly extracted Electron files. Only the installer is copied back.
const { execSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const pkg = require(path.join(ROOT, 'package.json'))
const stage = path.join(os.tmpdir(), `${pkg.name}-build`)
const release = path.join(ROOT, 'release')

const platforms = ['--win', '--mac'].filter((f) => process.argv.includes(f))
if (platforms.length === 0) platforms.push('--win')

const run = (cmd) => {
  console.log('\n> ' + cmd)
  execSync(cmd, { stdio: 'inherit', cwd: ROOT })
}

fs.rmSync(stage, { recursive: true, force: true })
run('npx vite build')
if (platforms.includes('--mac')) run('node scripts/build-mac-helper.cjs')
run(`npx electron-builder ${platforms.join(' ')} --config.directories.output="${stage}"`)

fs.mkdirSync(release, { recursive: true })
for (const file of fs.readdirSync(stage)) {
  if (/\.(exe|dmg|blockmap)$/.test(file)) {
    fs.copyFileSync(path.join(stage, file), path.join(release, file))
    console.log('copied: release/' + file)
  }
}
