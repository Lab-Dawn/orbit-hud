// orbit-hud widget, the page: a pixel core that fills with the five-hour usage and
// glows while any Claude session works. Everything else stays tucked away: cards
// slide out of the core only when something needs a look or an answer (a question,
// a finished task, a warning), and slide back once dealt with. Hover the core for a
// glance, click it for the panel, drag it anywhere, right-click for options.
'use strict'

const P = window.Pixel
// The widget's words in the chosen language (app/i18n.js).
const tr = (key, vars) => window.I18N.t(key, vars)
// `hud` is the bridge preload.js puts on the window.
const $ = id => document.getElementById(id)

const ALIVE_MS = 120000 // the plugin rewrites its file at least every 30 s
const RECENT_MS = 60 * 60 * 1000 // the list keeps sessions active within the hour
const LINGER_MS = 12000 // a finished session shows as done this long
const CARD_GAP = 12
const PANEL_GAP = 10
const PANEL_W = 360
const EDGE = 8

const core = $('core')
const callouts = $('callouts')
const panel = $('panel')
const chat = $('chat')
const cards = { question: $('question'), notice: $('notice'), glance: $('glance') }

const S = {
  area: { x: 0, y: 0, width: 1920, height: 1080 },
  left: null, // the core's top-left, in screen coordinates
  top: null,
  scale: 2,
  isOpen: false,
  focusId: null,
  isCardsLeft: false,
  isAbove: true,
  isSideSet: false,
  panelTall: 420,
  isHovering: false,
  drag: null,
  pointerOver: false,
  sessions: [],
  order: [],
  account: [],
  windowSpends: [],
  fivePct: null,
  coreMode: 'idle',
  corePct: 0,
  coreFrame: 0,
  cardsDown: null,
  cardsAt: null,
}

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

function failure(err) {
  hud.failure(err && err.stack ? err.stack : String(err))
}

// ---------- formatting ----------

function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function formatReset(iso) {
  if (!iso) return ''
  const left = Date.parse(iso) - Date.now()
  if (!(left > 0)) return ''
  const minutes = left / 60000
  if (minutes < 60) return tr('reset.min', { n: Math.ceil(minutes) })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return tr('reset.hm', { h: hours, mm: String(Math.floor(minutes % 60)).padStart(2, '0') })
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest === 0 ? tr('reset.d', { d: days }) : tr('reset.dh', { d: days, h: rest })
}

function formatTokens(n) {
  if (n == null) return ''
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`
  if (n < 1000) return `${n}`
  return `${Math.round(n / 1000)}k`
}

function formatShare(pct, isPartial) {
  if (pct == null) return ''
  const mark = isPartial ? '≥' : '≈'
  if (pct < 1) return `${mark}<1%`
  return `${mark}${Math.round(pct)}%`
}

// The prompt cache as it stands: in use while the session works; else warm until the
// time to live runs out from the last request, low in its last fifth, then cold.
const TTL_MS = { '5m': 5 * 60 * 1000, '1h': 60 * 60 * 1000 }

function cacheState(s) {
  const c = s.cache
  if (!c || !c.isObserved) return null
  const ttl = c.ttl || '5m'
  const span = TTL_MS[ttl]
  const left = c.requestAt + span - Date.now()
  let state = 'cold'
  if (s.state === 'working') state = 'live'
  else if (left > span * 0.2) state = 'warm'
  else if (left > 0) state = 'low'
  return { ...c, ttl, left, state }
}

function formatLeft(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000))
  if (sec < 60) return tr('left.sec', { n: sec })
  return tr('left.min', { n: Math.ceil(sec / 60) })
}

function formatAgo(ms) {
  const min = Math.floor(Math.max(0, ms) / 60000)
  return min < 1 ? tr('ago.now') : tr('ago.min', { n: min })
}

const toTime = iso => (iso ? Date.parse(iso) : NaN)
const sameWindow = (a, b) => Number.isFinite(toTime(a)) && Number.isFinite(toTime(b)) && Math.abs(toTime(a) - toTime(b)) < 60000

const STATE_COLOR = { ask: 'Ask', working: 'Accent', done: 'Done', idle: 'Faint' }

// ---------- data: the sessions' files ----------

async function readSessions() {
  const raw = await hud.readSessions()
  const list = []
  const spends = []
  const now = Date.now()
  for (const { id, age, stamp, data: d, cache, activeAt } of raw) {
    if (d.spend && d.spend.windowUsd != null) {
      spends.push({ id, resetsAt: d.spend.resetsAt, usd: Number(d.spend.windowUsd), isPartial: !!d.spend.isPartial })
    }
    if (d.isEnded || age > ALIVE_MS) continue
    const view = await sessionView(id, d, age, stamp)
    // Listed while it works or asks, or when it was active within the hour; a session
    // with nothing done yet (no transcript, no turn) is new, so listed too.
    const w = d.work || {}
    const lastAt = Math.max(activeAt || 0, w.endedAt || 0, w.startedAt || 0)
    if (view.state === 'idle' && lastAt > 0 && now - lastAt > RECENT_MS) continue
    view.lastAt = lastAt
    view.cache = cache
    list.push(view)
  }
  S.windowSpends = spends
  return list
}

async function sessionView(id, d, ageMs, stamp) {
  const w = d.work
  let state = 'idle'
  let elapsed = 0
  if (d.question) state = 'ask'
  else if (w && w.isActive) {
    state = 'working'
    elapsed = d.writtenAt - w.startedAt + ageMs
  } else if (w && w.endedAt > 0 && w.actions > 0 && d.writtenAt - w.endedAt + ageMs < LINGER_MS) {
    state = 'done'
    elapsed = w.endedAt - w.startedAt
  }
  let ctx = null
  for (const m of d.usage || []) if (m.short === 'ctx') ctx = m.pct
  let app = { appId: null, title: null }
  try {
    app = await hud.appSession(id)
  } catch {}
  const title = app.title || d.title || d.project || id.slice(0, 8)
  return { id, data: d, isLite: !!d.isLite, state, elapsed, ctx, stamp, startedAt: w ? w.startedAt : 0, title, appId: app.appId, windowUsd: null, windowPct: null, isPartial: false }
}

// A limit's name in the widget's language; one it has no word for keeps the plugin's.
function usageLabel(m) {
  const word = tr(`usage.${m.short}`)
  return word === `usage.${m.short}` ? m.label : word
}

// Per limit: the reading of the newest window, and within one window the one a
// session measured most recently (a plan change can lower the figure mid-window, and
// an idle session keeps the old one). Without measuring times, the higher.
function accountUsage(list) {
  const best = new Map()
  for (const s of list) {
    const at = Number(s.data.limitsAt) || 0
    for (const m of s.data.usage || []) {
      if (m.short === 'ctx') continue
      const have = best.get(m.short)
      if (!have) {
        best.set(m.short, { m, at })
        continue
      }
      const mine = toTime(m.resetsAt)
      const theirs = toTime(have.m.resetsAt)
      const isLater = Number.isFinite(mine) && (!Number.isFinite(theirs) || mine - theirs > 60000)
      const isSame = Number.isFinite(mine) && Number.isFinite(theirs) && Math.abs(mine - theirs) <= 60000
      const isNewer = at > 0 || have.at > 0 ? at > have.at : m.pct > have.m.pct
      if (isLater || (isSame && isNewer)) best.set(m.short, { m, at })
    }
  }
  const now = Date.now()
  return [...best.values()].map(({ m }) => {
    const resets = toTime(m.resetsAt)
    // A window that has ended with no newer reading has no usage yet.
    const label = usageLabel(m)
    if (Number.isFinite(resets) && resets < now) return { label, short: m.short, pct: 0, resetsAt: null, isStale: true }
    return { label, short: m.short, pct: m.pct, resetsAt: m.resetsAt, isStale: false }
  })
}

// Shares each session's spend in the running five-hour window out of the window's
// usage: its cost over every session's cost in that window, times the 5h percent.
function setWindowShares(list) {
  const five = S.account.find(m => m.short === '5h')
  S.fivePct = five ? Number(five.pct) : null
  const resetsAt = five && !five.isStale ? five.resetsAt : null
  const inWindow = S.windowSpends.filter(x => sameWindow(x.resetsAt, resetsAt))
  const sum = inWindow.reduce((a, x) => a + x.usd, 0)
  for (const s of list) {
    const mine = inWindow.find(x => x.id === s.id)
    s.windowUsd = mine ? mine.usd : null
    s.isPartial = mine ? mine.isPartial : false
    s.windowPct = mine && sum > 0 && S.fivePct != null ? (S.fivePct * mine.usd) / sum : null
  }
}

const findSession = id => S.sessions.find(s => s.id === id)
function openApp(s) {
  if (s && s.appId) hud.openLink(`claude://claude.ai/epitaxy/${s.appId}`)
}

// ---------- the core ----------

const coreCtx = core.getContext('2d')
function setScale(k) {
  S.scale = k
  const size = P.N * k
  core.style.width = `${size}px`
  core.style.height = `${size}px`
}
function drawCore() {
  P.drawCore(coreCtx, S.coreMode, S.coreFrame, S.corePct)
}

// The lamp chase and pulse run on their own clock, a frame every 110 ms; the row
// cores turn every other frame.
setInterval(() => {
  S.coreFrame = (S.coreFrame + 1) % 1200
  if (S.coreMode !== 'idle') drawCore()
  if (S.coreFrame % 2 === 0) stepMinis()
}, 110)

// ---------- cards: slide out of the core, slide back in ----------

function showCard(card) {
  if (card.dataset.state === 'in') return
  card.dataset.state = 'in'
  clearTimeout(card._hideTimer)
  card.hidden = false
  card.classList.add('is-out')
  void card.offsetWidth
  card.classList.remove('is-out')
}

function hideCard(card) {
  if (card.dataset.state !== 'in') return
  card.dataset.state = 'out'
  card.classList.add('is-out')
  card._hideTimer = setTimeout(() => {
    if (card.dataset.state !== 'out') return
    card.hidden = true
    card.dataset.state = ''
    layout()
  }, 230)
}

// Gone at once, no fade: for a card whose place is about to change.
function dropCard(card) {
  clearTimeout(card._hideTimer)
  card.hidden = true
  card.dataset.state = ''
  card.classList.remove('is-out')
}

// The question nearest the core's edge the cards grow from, notices and the glance beyond.
function setCardOrder(isDown) {
  if (S.cardsDown === isDown) return
  S.cardsDown = isDown
  const order = isDown ? [cards.question, cards.notice, cards.glance] : [cards.glance, cards.notice, cards.question]
  for (const c of order) callouts.appendChild(c)
}

// ---------- layout ----------

function coreSize() {
  return P.N * S.scale
}

// Cards come out on the side of the core facing the middle of its monitor.
function setCardSide(isFresh) {
  if (S.drag) return
  const isLeft = sides(isFresh).willLeft
  S.isCardsLeft = isLeft
  callouts.classList.toggle('is-left', isLeft)
  callouts.classList.toggle('is-right', !isLeft)
}

// The panel opens upward when it fits above the core, otherwise downward; decided
// once per opening, flipped only if it stops fitting.
function setPanelSide() {
  if (S.drag && S.isSideSet) return
  const ph = panel.offsetHeight || S.panelTall
  S.panelTall = Math.max(S.panelTall, panel.offsetHeight || 0)
  const fitsAbove = S.top - S.area.y - ph - PANEL_GAP >= 0
  if (S.isSideSet && (!S.isAbove || fitsAbove)) return
  S.isSideSet = true
  S.isAbove = fitsAbove
}

function place(node, x, y) {
  node.style.left = `${Math.round(x)}px`
  node.style.top = `${Math.round(y)}px`
}

function layout() {
  const s = coreSize()
  const cx = S.left - S.area.x
  const cy = S.top - S.area.y
  place(core, cx, cy)
  const hasPanel = !panel.hidden
  const hasChat = hasPanel && !chat.hidden
  const ph = hasPanel ? panel.offsetHeight : 0
  if (ph > S.panelTall) S.panelTall = ph
  if (!hasPanel && !S.drag) S.isAbove = sides(false).willAbove
  const cw = callouts.offsetWidth
  const ch = callouts.offsetHeight
  const panelX = S.isCardsLeft ? s - PANEL_W : 0
  const panelY = S.isAbove ? -PANEL_GAP - ph : s + PANEL_GAP
  let cardLeft
  let cardTop
  let isDown
  if (!hasPanel) {
    // Shut: the cards stand beside the core and grow away from the panel's side,
    // down from the core's top edge when it opens above, up from its bottom edge
    // when it opens below.
    isDown = S.isAbove
    cardLeft = S.isCardsLeft ? -CARD_GAP - cw : s + CARD_GAP
    cardTop = isDown ? Math.min(0, S.area.height - EDGE - cy - ch) : Math.max(s - ch, EDGE - cy)
  } else {
    // Open: panel, chat and cards stand in one row along the panel's edge next to the
    // core, side by side outward, each growing away from the core.
    isDown = !S.isAbove
    const base = S.isAbove ? -PANEL_GAP : s + PANEL_GAP
    let edge = S.isCardsLeft ? panelX : panelX + PANEL_W
    place(panel, cx + panelX, cy + panelY)
    if (hasChat) {
      const chatW = chat.offsetWidth
      const chatH = chat.offsetHeight
      const chatX = S.isCardsLeft ? edge - PANEL_GAP - chatW : edge + PANEL_GAP
      place(chat, cx + chatX, cy + (S.isAbove ? base - chatH : base))
      edge = S.isCardsLeft ? chatX : chatX + chatW
    }
    cardLeft = S.isCardsLeft ? edge - PANEL_GAP - cw : edge + PANEL_GAP
    cardTop = S.isAbove ? base - ch : base
    cardTop = Math.max(cardTop, EDGE - cy)
    cardTop = Math.min(cardTop, S.area.height - EDGE - cy - ch)
  }
  setCardOrder(isDown)
  place(callouts, cx + cardLeft, cy + cardTop)
  // When the cards must step to a new spot (aside for the panel, say), they glide
  // there instead of jumping; compared by the edges that stay put as they resize.
  const edgeX = S.area.x + cx + cardLeft + (S.isCardsLeft ? cw : 0)
  const edgeY = S.area.y + cy + cardTop + (isDown ? 0 : ch)
  glideCards(edgeX, edgeY)
}

function glideCards(x, y) {
  const was = S.cardsAt
  S.cardsAt = { x, y }
  const isShown = Object.values(cards).some(c => !c.hidden)
  if (!was || !isShown || S.drag) return
  const dx = was.x - x
  const dy = was.y - y
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
  callouts.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' })
}

// ---------- pointer: pieces take the pointer, the rest lets it through ----------

document.addEventListener('mousemove', e => {
  const t = document.elementFromPoint(e.clientX, e.clientY)
  const isOver = !!S.drag || !!(t && t.closest('.hit'))
  if (isOver !== S.pointerOver) {
    S.pointerOver = isOver
    hud.pointer(isOver)
  }
})

// Dragging moves the core (and whatever is open around it). A press that ends where
// it started is a click, which opens or closes the panel.
core.addEventListener('pointerdown', e => {
  if (e.button !== 0) return
  core.setPointerCapture(e.pointerId)
  S.drag = { sx: e.screenX, sy: e.screenY, left: S.left, top: S.top, isMoved: false }
})

core.addEventListener('pointermove', async e => {
  const d = S.drag
  if (!d) return
  const dx = e.screenX - d.sx
  const dy = e.screenY - d.sy
  if (!d.isMoved && Math.abs(dx) + Math.abs(dy) < 4) return
  if (!d.isMoved) dropCard(cards.glance)
  d.isMoved = true
  S.left = d.left + dx
  S.top = d.top + dy
  // While the window is going to another monitor, the pieces wait for the new area.
  if (d.isCrossing) return
  // Past this monitor's edge, the window goes to the monitor under the core. The
  // window and the pieces can't move in the same frame, so the pieces are hidden for
  // the switch and come back already in place.
  const center = { x: Math.round(S.left + coreSize() / 2), y: Math.round(S.top + coreSize() / 2) }
  const a = S.area
  if (center.x < a.x || center.x >= a.x + a.width || center.y < a.y || center.y >= a.y + a.height) {
    d.isCrossing = true
    const root = $('root')
    root.style.transition = 'none'
    root.style.opacity = '0'
    const area = await hud.moveCore(center)
    if (area) S.area = area
    d.isCrossing = false
    followSides(true)
    layout()
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.style.opacity = '1'
    }))
    return
  }
  followSides(false)
  layout()
})

core.addEventListener('pointerup', e => {
  const d = S.drag
  if (!d) return
  S.drag = null
  core.releasePointerCapture(e.pointerId)
  if (d.isMoved) {
    hud.savePrefs({ left: S.left, top: S.top })
    $('root').style.opacity = '1'
    layout()
  } else {
    S.isOpen = !S.isOpen
    S.isSideSet = false
    if (S.isOpen) dropCard(cards.glance)
    update()
  }
})

// While dragging, the sides cards and panel open towards follow the core as it goes:
// past the middle of the monitor the cards change sides, near the top the panel opens
// downward. A margin keeps them from flapping when the core rests near the line; on a
// new monitor (isFresh) they are simply decided anew. What changes side fades in.
const SIDE_MARGIN = 40
function sides(isFresh) {
  const mid = S.left + coreSize() / 2 - (S.area.x + S.area.width / 2)
  let willLeft = S.isCardsLeft
  if (isFresh) willLeft = mid > 0
  else if (mid > SIDE_MARGIN) willLeft = true
  else if (mid < -SIDE_MARGIN) willLeft = false
  const ph = panel.hidden ? S.panelTall : panel.offsetHeight
  const room = S.top - S.area.y - ph - PANEL_GAP
  let willAbove = S.isAbove
  if (isFresh) willAbove = room >= 0
  else if (room >= SIDE_MARGIN / 2) willAbove = true
  else if (room < 0) willAbove = false
  return { willLeft, willAbove }
}

function followSides(isFresh) {
  const { willLeft, willAbove } = sides(isFresh)
  if (willLeft === S.isCardsLeft && willAbove === S.isAbove) return
  S.isCardsLeft = willLeft
  callouts.classList.toggle('is-left', willLeft)
  callouts.classList.toggle('is-right', !willLeft)
  S.isAbove = willAbove
  S.isSideSet = true
  for (const el of [callouts, panel, chat]) {
    if (!el.hidden) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' })
  }
}

core.addEventListener('pointerenter', () => {
  S.isHovering = true
  update()
})
core.addEventListener('pointerleave', () => {
  S.isHovering = false
  update()
})
core.addEventListener('contextmenu', e => {
  e.preventDefault()
  hud.menu(S.scale)
})
// The same menu from the panel, where it can be found: language, size, position.
$('settings').append(P.icon('gear', 'Muted'))
$('settings').addEventListener('click', e => {
  e.stopPropagation()
  hud.menu(S.scale)
})

hud.on('scale', k => {
  setScale(k)
  hud.savePrefs({ scale: k })
  S.isSideSet = false
  update()
})

function defaultPosition() {
  return { left: S.area.x + S.area.width - 130, top: S.area.y + S.area.height - 150 }
}

hud.on('reset-position', () => {
  const p = defaultPosition()
  S.left = p.left
  S.top = p.top
  hud.savePrefs({ left: S.left, top: S.top })
  S.isSideSet = false
  setCardSide(true)
  update()
})

hud.on('area', area => {
  S.area = area
  layout()
})

hud.on('hidden', isHidden => {
  if (isHidden) S.isOpen = false
  else {
    const root = $('root')
    root.style.transition = 'none'
    root.style.opacity = '0'
    requestAnimationFrame(() => {
      root.style.transition = 'opacity 180ms'
      root.style.opacity = '1'
    })
  }
})
