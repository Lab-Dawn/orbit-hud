// orbit-hud widget, main process.
//
// The widget is one transparent, always-on-top window covering the work area of the
// monitor the core is on. Everything (core, cards, panel, chat) is drawn inside it,
// so nothing that opens or closes ever moves or resizes the window; only crossing
// to another monitor does. Empty parts let clicks through to whatever is below.
//
// The plugin in each Claude Code session talks to the widget through files in the
// live folder (~/.claude/orbit-hud-live, or ORBIT_HUD_LIVE for a second widget on
// other data): sessions/<id>.json in, commands/, answers/, prompts/, chat/ out.
const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, Menu } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const liveDir = process.env.ORBIT_HUD_LIVE || path.join(os.homedir(), '.claude', 'orbit-hud-live')
// A second widget on another live folder keeps its own browser data and lock.
app.setPath('userData', path.join(liveDir, '.widget'))
// ORBIT_HUD_CAPTURE draws off screen at twice the size, for crisp README pictures: a
// stage half the primary monitor's work area (Windows keeps a window within the screen).
const IS_CAPTURE = !!process.env.ORBIT_HUD_CAPTURE
let CAPTURE = null
const ZOOM = IS_CAPTURE ? 2 : 1

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(start)
}

const prefsPath = path.join(liveDir, 'widget.json')
const snapRequest = path.join(liveDir, 'snap-request')
const widgetCommand = path.join(liveDir, 'widget-command')
const HOTKEY = 'Control+Alt+O'

let win = null
let latestFrame = null
let display = null
let prefs = { left: null, top: null, scale: 2, hidden: false }

function readPrefs() {
  try {
    prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsPath, 'utf8')) }
  } catch {}
}

function savePrefs() {
  try {
    fs.mkdirSync(liveDir, { recursive: true })
    fs.writeFileSync(prefsPath, JSON.stringify(prefs))
  } catch {}
}

function logFailure(err) {
  try {
    fs.writeFileSync(path.join(liveDir, 'widget-error.log'), `${new Date().toISOString()}\n${err && err.stack ? err.stack : err}`)
  } catch {}
}

// The monitor the core sits on; a saved spot on a monitor that has gone falls back
// to the primary one, bottom right.
function displayFor(x, y) {
  if (x == null || y == null) return screen.getPrimaryDisplay()
  const hit = screen.getAllDisplays().find(d => {
    const a = d.workArea
    return x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height
  })
  return hit || null
}

function placeOn(d) {
  display = d
  const a = d.workArea
  win.setBounds({ x: a.x, y: a.y, width: a.width, height: a.height })
}

function areaInfo() {
  if (CAPTURE) return CAPTURE
  const a = display.workArea
  return { x: a.x, y: a.y, width: a.width, height: a.height }
}

function start() {
  readPrefs()
  if (IS_CAPTURE) {
    const wa = screen.getPrimaryDisplay().workArea
    CAPTURE = { x: 0, y: 0, width: Math.floor(wa.width / ZOOM), height: Math.floor(wa.height / ZOOM) }
    // The core near the bottom right, with room above it for the panel and chat.
    prefs = { ...prefs, left: CAPTURE.width - 130, top: CAPTURE.height - 66, hidden: false }
  }
  let d = displayFor(prefs.left, prefs.top)
  if (!d) {
    d = screen.getPrimaryDisplay()
    prefs.left = null
    prefs.top = null
  }
  const a = CAPTURE ? { x: 0, y: 0, width: CAPTURE.width * ZOOM, height: CAPTURE.height * ZOOM } : d.workArea
  win = new BrowserWindow({
    x: a.x, y: a.y, width: a.width, height: a.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#00000000',
    title: 'Orbit HUD',
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: !!CAPTURE,
    },
  })
  display = d
  win.setAlwaysOnTop(true, 'screen-saver')
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Empty parts let the pointer through; the page asks for it back over its pieces.
  win.setIgnoreMouseEvents(true, { forward: true })
  win.loadFile(path.join(__dirname, 'index.html'))
  win.once('ready-to-show', () => {
    if (CAPTURE) win.webContents.setZoomFactor(ZOOM)
    else if (!prefs.hidden) win.showInactive()
  })
  // On the capture stage, frames come painted off screen; the latest one is kept.
  if (CAPTURE) {
    win.webContents.setFrameRate(30)
    win.webContents.on('paint', (_e, _dirty, image) => {
      latestFrame = image
    })
  }
  win.webContents.on('render-process-gone', (_e, details) => logFailure(`renderer gone: ${details.reason}`))
  // With ORBIT_HUD_DEBUG set, the page's console goes to stdout.
  if (process.env.ORBIT_HUD_DEBUG) win.webContents.on('console-message', e => console.log(`[page] ${e.level}: ${e.message} (${e.sourceId}:${e.lineNumber})`))

  if (!CAPTURE && !globalShortcut.register(HOTKEY, () => setHidden(!prefs.hidden))) {
    logFailure(`${HOTKEY} is taken by another program; use /hud on|off or the menu.`)
  }
  setInterval(checkFiles, 500)
  if (CAPTURE) return
  screen.on('display-metrics-changed', () => {
    if (display) placeOn(screen.getDisplayNearestPoint({ x: display.workArea.x + 1, y: display.workArea.y + 1 }))
    send('area', areaInfo())
  })
}

function send(channel, value) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, value)
}

function setHidden(isHidden) {
  if (prefs.hidden === isHidden) return
  prefs.hidden = isHidden
  savePrefs()
  if (isHidden) {
    send('hidden', true)
    win.hide()
  } else {
    win.showInactive()
    send('hidden', false)
  }
}

// /hud on|off leave a word in a file; the snapshot request is for checking how it
// looks, and can first press a piece of it (debug and README pictures).
let isSnapping = false
function checkFiles() {
  try {
    if (fs.existsSync(widgetCommand)) {
      const word = fs.readFileSync(widgetCommand, 'utf8').trim()
      fs.rmSync(widgetCommand, { force: true })
      if (word === 'hide') setHidden(true)
      else if (word === 'show') setHidden(false)
      else if (word === 'toggle') setHidden(!prefs.hidden)
    }
    if (!isSnapping && fs.existsSync(snapRequest)) {
      isSnapping = true
      const word = fs.readFileSync(snapRequest, 'utf8').trim()
      fs.rmSync(snapRequest, { force: true })
      send('debug', word)
    }
  } catch (err) {
    logFailure(err)
  }
}

// ---------- calls from the page ----------

ipcMain.handle('area', () => areaInfo())
ipcMain.handle('prefs', () => prefs)
ipcMain.handle('platform', () => process.platform)

ipcMain.on('save-prefs', (_e, value) => {
  prefs = { ...prefs, ...value }
  savePrefs()
})

ipcMain.on('pointer', (_e, isOverPiece) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!isOverPiece, { forward: true })
})

// The core was dragged to a screen point: past this monitor's edge, the window goes
// to the monitor under it.
ipcMain.handle('move-core', (_e, point) => {
  if (CAPTURE) return null
  const d = screen.getDisplayNearestPoint(point)
  if (d.id !== display.id) {
    placeOn(d)
    return areaInfo()
  }
  return null
})

ipcMain.handle('read-sessions', () => readSessions())
ipcMain.handle('read-file', (_e, rel) => readLive(rel))
ipcMain.handle('file-stamp', (_e, rel) => {
  try {
    return fs.statSync(safeLive(rel)).mtimeMs
  } catch {
    return 0
  }
})
ipcMain.on('write-file', (_e, rel, text) => writeLive(rel, text))
ipcMain.on('write-png', (_e, rel, dataUrl) => {
  try {
    const full = safeLive(rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, Buffer.from(String(dataUrl).split(',')[1] || '', 'base64'))
  } catch (err) {
    logFailure(err)
  }
})
ipcMain.handle('app-session', (_e, cliId) => resolveAppSession(cliId))

ipcMain.on('open-link', (_e, url) => {
  if (typeof url === 'string' && url.startsWith('claude://')) shell.openExternal(url).catch(logFailure)
})

ipcMain.on('hide', () => setHidden(true))
ipcMain.on('quit', () => app.quit())
ipcMain.on('failure', (_e, text) => logFailure(text))

ipcMain.on('menu', (_e, scale) => {
  const menu = Menu.buildFromTemplate([
    {
      label: '코어 크기',
      submenu: [2, 3, 4].map((k, i) => ({
        label: ['작게 (64px)', '보통 (96px)', '크게 (128px)'][i],
        type: 'radio',
        checked: scale === k,
        click: () => send('scale', k),
      })),
    },
    { label: '위치 초기화', click: () => send('reset-position') },
    { label: '숨기기', accelerator: 'Ctrl+Alt+O', click: () => setHidden(true) },
    { type: 'separator' },
    { label: '위젯 종료', click: () => app.quit() },
  ])
  menu.popup({ window: win })
})

// A picture of the widget's pieces (its own window only, nothing else on screen).
ipcMain.on('snap', async (_e, rect) => {
  try {
    let image
    if (CAPTURE) {
      latestFrame = null
      win.webContents.invalidate()
      for (let i = 0; i < 50 && !latestFrame; i++) await new Promise(r => setTimeout(r, 40))
      const size = latestFrame.getSize()
      const k = size.width / CAPTURE.width
      image = rect ? latestFrame.crop({ x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.round(rect.width * k), height: Math.round(rect.height * k) }) : latestFrame
    } else {
      image = await win.webContents.capturePage(rect)
    }
    fs.writeFileSync(path.join(liveDir, 'snap.png'), image.toPNG())
  } catch (err) {
    logFailure(err)
  }
  isSnapping = false
})

// ---------- files ----------

function safeLive(rel) {
  const full = path.resolve(liveDir, rel)
  if (!full.startsWith(path.resolve(liveDir))) throw new Error(`outside the live folder: ${rel}`)
  return full
}

function readLive(rel) {
  try {
    return fs.readFileSync(safeLive(rel), 'utf8')
  } catch {
    return null
  }
}

function writeLive(rel, text) {
  try {
    const full = safeLive(rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, text)
  } catch (err) {
    logFailure(err)
  }
}

// Every session file under five hours old (older ones cannot belong to the running
// window), parsed once per change, with its age.
const parsed = new Map()
function readSessions() {
  const dir = path.join(liveDir, 'sessions')
  const now = Date.now()
  const out = []
  let names = []
  try {
    names = fs.readdirSync(dir).filter(n => n.endsWith('.json'))
  } catch {
    return out
  }
  for (const name of names) {
    const full = path.join(dir, name)
    let stat
    try {
      stat = fs.statSync(full)
    } catch {
      continue
    }
    const age = now - stat.mtimeMs
    if (age > 5 * 3600 * 1000) continue
    let cached = parsed.get(full)
    if (!cached || cached.stamp !== stat.mtimeMs) {
      try {
        cached = { stamp: stat.mtimeMs, data: JSON.parse(fs.readFileSync(full, 'utf8').replace(/^﻿/, '')) }
        parsed.set(full, cached)
      } catch {
        if (!cached) continue
      }
    }
    out.push({ id: name.slice(0, -5), age, stamp: stat.mtimeMs, data: cached.data })
  }
  return out
}

// The Claude app keeps a file per session naming its CLI session id; it gives the
// session's title and the id its claude:// link needs.
const appRoot =
  process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'Claude', 'claude-code-sessions')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions')
      : path.join(os.homedir(), '.config', 'Claude', 'claude-code-sessions')
const appSessions = new Map()

function listAppFiles(dir, out = []) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) listAppFiles(full, out)
    else if (e.name.startsWith('local_') && e.name.endsWith('.json')) out.push(full)
  }
  return out
}

function resolveAppSession(cliId) {
  const now = Date.now()
  const known = appSessions.get(cliId)
  if (known && (now - known.checkedAt < (known.file ? 60000 : 20000))) return known
  const entry = { appId: null, title: null, file: known?.file ?? null, checkedAt: now }
  try {
    const files = entry.file ? [entry.file] : listAppFiles(appRoot)
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      if (!text.includes(cliId)) continue
      const j = JSON.parse(text)
      if (j.cliSessionId === cliId) {
        entry.appId = j.sessionId
        entry.title = j.title
        entry.file = file
        break
      }
    }
  } catch {}
  appSessions.set(cliId, entry)
  return entry
}

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
