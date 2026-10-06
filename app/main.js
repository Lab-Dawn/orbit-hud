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
const I18N = require('./i18n.js')

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
let prefs = { left: null, top: null, scale: 2, hidden: false, lang: 'auto' }

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
    // A laptop's half is too short for the question card; macOS lets an off-screen
    // window be taller than the screen, so the stage has a floor there.
    const floor = process.platform === 'darwin' ? { width: 960, height: 600 } : { width: 0, height: 0 }
    CAPTURE = {
      x: 0,
      y: 0,
      width: Math.max(floor.width, Math.floor(wa.width / ZOOM)),
      height: Math.max(floor.height, Math.floor(wa.height / ZOOM)),
    }
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

// /hud on|off|lang leave a word in a file; the snapshot request is for checking how it
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
      else if (word.startsWith('lang:')) chooseLang(word.slice(5))
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
// A pasted file has no path of its own: it is kept in the live folder for the
// session to read, under a name of its own.
ipcMain.handle('save-attachment', (_e, name, bytes) => {
  const data = Buffer.from(bytes)
  if (data.length > 30 * 1024 * 1024) throw new Error('too large')
  const safe = path.basename(String(name || 'pasted')).replace(/[^\w.\-가-힣]/g, '_').slice(-80) || 'pasted'
  const dir = path.join(liveDir, 'attachments')
  fs.mkdirSync(dir, { recursive: true })
  const full = path.join(dir, `${Date.now().toString(36)}-${safe}`)
  fs.writeFileSync(full, data)
  return full
})

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

// The widget's language: the menu's choice, or the system's on "auto" (English when
// it is none of the three). The resolved one is saved too, for the plugin to follow.
function applyLang() {
  const lang = I18N.resolve(prefs.lang, app.getLocale())
  I18N.setLang(lang)
  if (prefs.langResolved !== lang) {
    prefs.langResolved = lang
    savePrefs()
  }
  return lang
}

ipcMain.handle('lang', () => applyLang())

// From the menu, or /hud lang through the command file: "auto" or a language.
function chooseLang(choice) {
  if (choice !== 'auto' && !I18N.LANGS.includes(choice)) return
  prefs.lang = choice
  savePrefs()
  send('lang', applyLang())
}

ipcMain.on('menu', (_e, scale) => {
  const t = I18N.t
  const menu = Menu.buildFromTemplate([
    {
      label: t('menu.size'),
      submenu: [2, 3, 4].map((k, i) => ({
        label: t(['menu.small', 'menu.medium', 'menu.large'][i]),
        type: 'radio',
        checked: scale === k,
        click: () => send('scale', k),
      })),
    },
    {
      label: t('menu.language'),
      submenu: ['auto', ...I18N.LANGS].map(choice => ({
        label: choice === 'auto' ? t('menu.auto') : I18N.NAMES[choice],
        type: 'radio',
        checked: (prefs.lang || 'auto') === choice,
        click: () => chooseLang(choice),
      })),
    },
    { label: t('menu.resetPosition'), click: () => send('reset-position') },
    { label: t('menu.hide'), accelerator: 'Ctrl+Alt+O', click: () => setHidden(true) },
    { type: 'separator' },
    { label: t('menu.quit'), click: () => app.quit() },
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
// window), parsed once per change, with its age; and every session whose transcript
// moved in the last hour, so one that has no plugin in it (started before the plugin
// was set up, or the plugin failed to load) is listed too, from its transcript alone.
const RECENT_MS = 60 * 60 * 1000
const parsed = new Map()
function readSessions() {
  const dir = path.join(liveDir, 'sessions')
  const now = Date.now()
  const out = []
  const recent = recentTranscripts(now)
  let names = []
  try {
    names = fs.readdirSync(dir).filter(n => n.endsWith('.json'))
  } catch {}
  const seen = new Set()
  const stale = new Map()
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
    const id = name.slice(0, -5)
    const t = recent.get(id)
    // A plugin that stopped writing, or a session going on after its plugin said it
    // ended (resumed without it), is left to the transcript, its spend kept in the sums.
    const isGone = cached.data.isEnded ? t && t.mtimeMs > stat.mtimeMs + 5000 : age > PLUGIN_ALIVE_MS
    if (t && isGone) {
      stale.set(id, cached.data)
      continue
    }
    seen.add(id)
    const transcript = cached.data.transcript || (t && t.file)
    out.push({ id, age, stamp: stat.mtimeMs, data: cached.data, cache: readCache(transcript), activeAt: t ? t.mtimeMs : 0 })
  }
  for (const [id, t] of recent) {
    if (seen.has(id)) continue
    const sketch = transcriptSession(t)
    if (!sketch) continue
    const data = stale.has(id) ? { ...sketch, spend: stale.get(id).spend } : sketch
    out.push({ id, age: 0, stamp: t.mtimeMs, data, cache: readCache(t.file), activeAt: t.mtimeMs })
  }
  return out
}

// The plugin rewrites its file at least every 30 s; past this it is not running.
const PLUGIN_ALIVE_MS = 120000

// Transcripts are ~/.claude/projects/<project>/<session id>.jsonl; the folders are
// listed every so often, the files' times every read. ORBIT_HUD_PROJECTS points a
// second widget elsewhere (the README pictures show no real session).
const projectsDir =
  process.env.ORBIT_HUD_PROJECTS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
let transcriptFiles = []
let listedAt = 0
function recentTranscripts(now) {
  if (now - listedAt > 15000) {
    listedAt = now
    const files = []
    let dirs = []
    try {
      dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory())
    } catch {}
    for (const d of dirs) {
      const sub = path.join(projectsDir, d.name)
      try {
        for (const n of fs.readdirSync(sub)) if (n.endsWith('.jsonl')) files.push(path.join(sub, n))
      } catch {}
    }
    transcriptFiles = files
  }
  const out = new Map()
  for (const file of transcriptFiles) {
    let stat
    try {
      stat = fs.statSync(file)
    } catch {
      continue
    }
    if (now - stat.mtimeMs > RECENT_MS) continue
    out.set(path.basename(file, '.jsonl'), { file, mtimeMs: stat.mtimeMs, size: stat.size })
  }
  return out
}

// What a transcript says of its session, for one the plugin does not describe: the
// folder it works in, its title, and whether a turn is under way (lines still coming).
const sketches = new Map()
const WORKING_MS = 20000
function transcriptSession(t) {
  let sketch = sketches.get(t.file)
  if (!sketch || sketch.size !== t.size) {
    const tail = readTail(t.file, t.size, 256 * 1024)
    if (tail == null) return null
    const prev = sketch || { cwd: '', title: '', isMain: false }
    sketch = { size: t.size, cwd: prev.cwd, title: prev.title, isMain: prev.isMain, isTurnOpen: false }
    for (const line of tail.split('\n')) {
      if (!line.startsWith('{')) continue
      const cwd = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(line)
      if (cwd) sketch.cwd = JSON.parse(`"${cwd[1]}"`)
      const title = /"type":"custom-title","customTitle":"((?:[^"\\]|\\.)*)"/.exec(line)
      if (title) sketch.title = JSON.parse(`"${title[1]}"`)
      if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) sketch.isMain = true
    }
    // A turn ends with the stop hooks' summary or a reply that ended its turn.
    const last = tail.trimEnd().split('\n').reverse().find(l => l.includes('"type":"user"') || l.includes('"type":"assistant"') || l.includes('"stop_hook_summary"'))
    sketch.isTurnOpen = !!last && !last.includes('"stop_hook_summary"') && !last.includes('"stop_reason":"end_turn"')
    sketches.set(t.file, sketch)
  }
  if (!sketch.isMain) return null
  const isActive = sketch.isTurnOpen && Date.now() - t.mtimeMs < WORKING_MS
  return {
    version: 1,
    isLite: true,
    project: sketch.cwd.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '',
    title: sketch.title,
    writtenAt: Date.now(),
    isEnded: false,
    question: null,
    transcript: t.file,
    spend: null,
    usage: [],
    work: { isActive, startedAt: isActive ? t.mtimeMs : 0, endedAt: 0, files: 0, edited: 0, actions: 0, current: null, recent: [] },
  }
}

function readTail(file, size, max) {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const len = Math.min(size, max)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, size - len)
      const text = buf.toString('utf8')
      return size > len ? text.slice(text.indexOf('\n') + 1) : text
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}

// ---------- the prompt cache, from the session's transcript ----------
// Every response the transcript records carries its token counts: what the cache
// served (cache_read), what was written to it (cache_creation, split by time to live)
// and what went uncached. Read as the file grows, only the new part each time.

// The first look at a long transcript starts this far from its end.
const FIRST_READ = 8 * 1024 * 1024
const ledgers = new Map()

function readCache(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !file.endsWith('.jsonl')) return null
  let ledger = ledgers.get(file)
  if (!ledger) {
    ledger = {
      offset: -1, ttl: null, requests: 0, read: 0, written: 0, uncached: 0, misses: 0,
      lastId: null, lastLineAt: 0, requestAt: 0, prefix: 0, isAfterCompact: false,
    }
    ledgers.set(file, ledger)
  }
  let size
  try {
    size = fs.statSync(file).size
  } catch {
    return null
  }
  if (ledger.offset < 0 || size < ledger.offset) ledger.offset = Math.max(0, size - FIRST_READ)
  if (size > ledger.offset) readLedger(file, ledger, size)
  if (ledger.requests === 0) return null
  const all = ledger.read + ledger.written + ledger.uncached
  return {
    ttl: ledger.ttl,
    requestAt: ledger.requestAt,
    hitRatio: all > 0 ? ledger.read / all : null,
    requests: ledger.requests,
    misses: ledger.misses,
    written: ledger.written,
    isObserved: ledger.read + ledger.written > 0,
  }
}

function readLedger(file, ledger, size) {
  let text
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(size - ledger.offset)
      fs.readSync(fd, buf, 0, buf.length, ledger.offset)
      text = buf.toString('utf8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return
  }
  // Only whole lines; a line still being written waits for the next read. A first
  // look that starts mid-file drops the cut line it starts on.
  const end = text.lastIndexOf('\n')
  if (end < 0) return
  let start = 0
  if (ledger.offset > 0 && ledger.requests === 0 && ledger.lastLineAt === 0) start = text.indexOf('\n') + 1
  ledger.offset += Buffer.byteLength(text.slice(0, end + 1), 'utf8')
  for (const line of text.slice(start, end).split('\n')) {
    if (line) takeLine(ledger, line)
  }
}

function takeLine(ledger, line) {
  const isUsage = line.includes('"cache_read_input_tokens"') && line.includes('"assistant"')
  if (!isUsage) {
    if (line.includes('"compact_boundary"')) ledger.isAfterCompact = true
    const at = /"timestamp":"([^"]+)"/.exec(line)
    if (at) ledger.lastLineAt = Date.parse(at[1]) || ledger.lastLineAt
    return
  }
  let entry
  try {
    entry = JSON.parse(line)
  } catch {
    return
  }
  const m = entry.message
  const u = m && m.usage
  if (entry.type !== 'assistant' || entry.isSidechain || !u || m.model === '<synthetic>') return
  // A response is written down once per content block, each with the same counts.
  if (m.id && m.id === ledger.lastId) return
  ledger.lastId = m.id
  const read = u.cache_read_input_tokens || 0
  const written = u.cache_creation_input_tokens || 0
  const uncached = u.input_tokens || 0
  ledger.requests += 1
  ledger.read += read
  ledger.written += written
  ledger.uncached += uncached
  const split = u.cache_creation || {}
  if (split.ephemeral_1h_input_tokens > 0) ledger.ttl = '1h'
  else if (split.ephemeral_5m_input_tokens > 0) ledger.ttl = '5m'
  // The cache's clock runs from the request, which went out when the line before the
  // response was written; the response's own time is the fallback.
  const at = Date.parse(entry.timestamp) || 0
  ledger.requestAt = ledger.lastLineAt > 0 && ledger.lastLineAt <= at ? ledger.lastLineAt : at
  ledger.lastLineAt = at
  // A miss: the cached prefix shrank by half or more with no compaction to explain it.
  if (ledger.prefix > 0 && !ledger.isAfterCompact && read < ledger.prefix / 2) ledger.misses += 1
  ledger.prefix = read + written + uncached
  ledger.isAfterCompact = false
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
