// Starts the widget, first installing Electron if this computer does not have it yet.
// The plugin runs this with Node at every session start; it returns as soon as the
// widget is up (the widget keeps to one instance, so a second start just exits).
//
// Electron lives outside the plugin folder, in ~/.claude/orbit-hud-live/runtime, so
// installing it never touches the plugin's files. A copy under app/node_modules (from
// `npm install` while working on the widget) is used first when present.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const app = __dirname
const liveDir = process.env.ORBIT_HUD_LIVE || path.join(os.homedir(), '.claude', 'orbit-hud-live')
const runtime = path.join(liveDir, 'runtime')
const version = require('./package.json').dependencies.electron

const exeIn = {
  win32: 'electron.exe',
  darwin: 'Electron.app/Contents/MacOS/Electron',
  linux: 'electron',
}[process.platform]

function electronDir(root) {
  return path.join(root, 'node_modules', 'electron')
}

function binaryOf(root) {
  const dir = electronDir(root)
  const exe = path.join(dir, 'dist', exeIn)
  return fs.existsSync(exe) ? exe : null
}

function install() {
  fs.mkdirSync(runtime, { recursive: true })
  fs.writeFileSync(
    path.join(runtime, 'package.json'),
    JSON.stringify({ name: 'orbit-hud-runtime', private: true, dependencies: { electron: version } }, null, 2),
  )
  const args = ['install', '--no-audit', '--no-fund', '--loglevel=error']
  // npm is a batch file on Windows, so it goes through cmd there.
  const [cmd, argv] = process.platform === 'win32' ? ['cmd.exe', ['/d', '/c', 'npm', ...args]] : ['npm', args]
  const run = spawnSync(cmd, argv, { cwd: runtime, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`npm install failed: ${(run.stderr || run.stdout || '').trim().slice(-600)}`)
}

// Electron's own unpacking can stop after the first file on recent Node versions,
// leaving no binary. The download is cached by then, so unpack it with the system's
// tools (tar on Windows, ditto on macOS, unzip elsewhere).
async function repair(root) {
  const dir = electronDir(root)
  const { downloadArtifact } = require(require.resolve('@electron/get', { paths: [dir] }))
  const pkg = require(path.join(dir, 'package.json'))
  const zip = await downloadArtifact({ version: pkg.version, artifactName: 'electron', platform: process.platform, arch: process.arch })
  const dist = path.join(dir, 'dist')
  fs.rmSync(dist, { recursive: true, force: true })
  fs.mkdirSync(dist, { recursive: true })
  const tool =
    process.platform === 'win32'
      ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dist]]
      : process.platform === 'darwin'
        ? ['ditto', ['-x', '-k', zip, dist]]
        : ['unzip', ['-q', zip, '-d', dist]]
  const run = spawnSync(tool[0], tool[1], { stdio: 'ignore' })
  if (run.status !== 0) throw new Error(`could not unpack ${zip}`)
  fs.writeFileSync(path.join(dir, 'path.txt'), exeIn)
}

async function main() {
  let root = binaryOf(app) ? app : runtime
  if (!binaryOf(root)) {
    root = runtime
    if (!fs.existsSync(electronDir(runtime))) {
      console.log('installing Electron')
      install()
    }
    if (!binaryOf(runtime)) await repair(runtime)
  }
  const exe = binaryOf(root)
  if (!exe) throw new Error('Electron is not installed')
  const child = spawn(exe, [app], { detached: true, stdio: 'ignore', env: process.env })
  child.unref()
  console.log('started')
}

main().catch(err => {
  console.error(String(err && err.message ? err.message : err))
  process.exit(1)
})
