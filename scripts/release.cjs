// Manual release: build the installer + create the GitHub Release and upload the file.
// Usage: npm run release            -> tags v<package.json version>
//        npm run release -- --dry   -> local steps only, GitHub untouched
// Requires: gh CLI signed in (gh auth login), clean working tree.
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
if (out('git status --porcelain')) fail('working tree is not clean; commit first')
if (out('git tag -l ' + tag)) fail(`${tag} already exists; bump the version in package.json`)
if (!dry) {
  if (spawnSync('gh', ['auth', 'status'], { stdio: 'ignore', shell: true }).status !== 0)
    fail('gh CLI is not signed in: gh auth login')
}

// 2) Package
run('npm run dist')

const installer = path.join(ROOT, 'release', `${pkg.productName} Setup ${pkg.version}.exe`)
if (!fs.existsSync(installer)) fail('installer not found: ' + installer)
console.log(`\ninstaller: ${installer} (${Math.round(fs.statSync(installer).size / 1048576)} MB)`)

if (dry) {
  console.log('\n--dry: skipped tag and GitHub Release')
  process.exit(0)
}

// 3) Tag + Release
run(`git tag -a ${tag} -m "${tag}"`)
run(`git push origin main ${tag}`)
const notes = `Windows installer for ${pkg.productName} ${pkg.version}.\n\nRequires Windows 10 or later. The installer is unsigned; accept the SmartScreen prompt on first run.`
run(`gh release create ${tag} "${installer}" --title "${tag}" --notes "${notes.replace(/"/g, '\\"')}"`)
console.log('\nRelease ready: ' + tag)
