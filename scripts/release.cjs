// Manual release: build the Windows installer and macOS DMGs + create the GitHub Release.
// Run on macOS: the Windows installer cross-builds there, the DMGs need a Mac.
// Usage: npm run release            -> tags v<package.json version>
//        npm run release -- --dry   -> local steps only, GitHub untouched
// Requires: macOS with the Xcode command line tools, gh CLI signed in (gh auth login), clean working tree.
const { execSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const pkg = require(path.join(ROOT, 'package.json'))
const tag = 'v' + pkg.version
const dry = process.argv.includes('--dry')

const run = (cmd, opts = {}) => {
  console.log('\n> ' + cmd)
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts })
}
const out = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim()
const fail = (msg) => {
  console.error('\nERROR: ' + msg)
  process.exit(1)
}

// 1) Preflight checks
if (process.platform !== 'darwin') fail('run the release on macOS; the DMGs can only be built there')
if (out('git status --porcelain')) fail('working tree is not clean; commit first')
if (out('git tag -l ' + tag)) fail(`${tag} already exists; bump the version in package.json`)
if (!dry) {
  if (spawnSync('gh', ['auth', 'status'], { stdio: 'ignore', shell: true }).status !== 0)
    fail('gh CLI is not signed in: gh auth login')
}

// 2) Package
run('npm run dist -- --win --mac')

const assets = [
  `${pkg.productName} Setup ${pkg.version}.exe`,
  `${pkg.productName}-${pkg.version}-arm64.dmg`,
  `${pkg.productName}-${pkg.version}-x64.dmg`
].map((f) => path.join(ROOT, 'release', f))
for (const f of assets) {
  if (!fs.existsSync(f)) fail('build output not found: ' + f)
  console.log(`${path.basename(f)} (${Math.round(fs.statSync(f).size / 1048576)} MB)`)
}

if (dry) {
  console.log('\n--dry: skipped tag and GitHub Release')
  process.exit(0)
}

// 3) Tag + Release
run(`git tag -a ${tag} -m "${tag}"`)
run(`git push origin main ${tag}`)
const notesFile = path.join(ROOT, 'release', 'release-notes.md')
fs.writeFileSync(
  notesFile,
  [
    `## Downloads`,
    ``,
    `- **Windows 10+ (64-bit):** \`${path.basename(assets[0]).replace(/ /g, '.')}\``,
    `- **macOS 12+, Apple Silicon:** \`${path.basename(assets[1]).replace(/ /g, '.')}\``,
    `- **macOS 12+, Intel:** \`${path.basename(assets[2]).replace(/ /g, '.')}\``,
    ``,
    `Neither build is signed by a publisher. On Windows choose **More info → Run anyway** in the SmartScreen prompt.`,
    `On macOS open the app once, then allow it under **System Settings → Privacy & Security → Open Anyway**,`,
    `and turn it on under **Privacy & Security → Accessibility** so it can paste.`
  ].join('\n')
)
run(`gh release create ${tag} ${assets.map((f) => `"${f}"`).join(' ')} --title "${tag}" --notes-file "${notesFile}"`)
console.log('\nRelease ready: ' + tag)
