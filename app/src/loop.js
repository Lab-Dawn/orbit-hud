// Every half second: read the sessions, then bring every piece up to date.
'use strict'

let isUpdating = false
let isQueued = false

async function update() {
  if (isUpdating) {
    isQueued = true
    return
  }
  isUpdating = true
  try {
    await tick()
  } catch (err) {
    failure(err)
  } finally {
    isUpdating = false
    if (isQueued) {
      isQueued = false
      update()
    }
  }
}

async function tick() {
  let list = await readSessions()
  sendOutboxes()
  $('root').hidden = list.length === 0

  // Sessions keep the place they first appeared in, so rows don't jump around.
  const ids = list.map(s => s.id)
  S.order = S.order.filter(id => ids.includes(id))
  for (const id of ids) if (!S.order.includes(id)) S.order.push(id)
  list = S.order.map(id => list.find(s => s.id === id))
  S.sessions = list
  S.account = accountUsage(list)
  setWindowShares(list)

  // The core: the 5h figure as its ring, the busiest state as its light.
  const five = S.account.find(m => m.short === '5h')
  const mode = list.some(s => s.state === 'ask') ? 'ask' : list.some(s => s.state === 'working') ? 'working' : 'idle'
  const pct = five ? Number(five.pct) : 0
  if (mode !== S.coreMode || pct !== S.corePct) {
    S.coreMode = mode
    S.corePct = pct
    drawCore()
  }

  setCardSide()
  watchEvents(list)
  updateQuestion(list)
  updateNotice()
  // While a question is out the glance stays in: the core already says it is asking.
  if (S.isHovering && !S.isOpen && !S.drag && !Q) {
    showGlance(list)
    showCard(cards.glance)
  } else hideCard(cards.glance)

  if (S.isOpen) {
    panel.hidden = false
    showUsage()
    updateSessionList(list)
    await updateChat()
    chat.hidden = !chatId
    setPanelSide()
  } else {
    panel.hidden = true
    chat.hidden = true
  }
  layout()
}

// ---------- pictures of the widget, for checking how it looks ----------
// A word in the live folder's snap-request presses a piece first (README pictures and
// checks), then the widget saves snap.png of its own pieces, nothing else on screen.

const wait = ms => new Promise(r => setTimeout(r, ms))

hud.on('debug', async word => {
  try {
    if (word.startsWith('pick:')) {
      const [qi, oi] = word.slice(5).split('|').map(Number)
      selectOption(qi, oi)
    } else if (word.startsWith('act:')) questionAction(word.slice(4))
    else if (word.startsWith('say:')) {
      chatText.value = word.slice(4)
      sendChat()
    } else if (word === 'hover' || word === 'unhover') {
      S.isHovering = word === 'hover'
      await update()
    } else if (word.startsWith('notice:')) {
      const [color, head, body] = word.slice(7).split('|')
      pushNotice(color, head, body, null, 'panel', 30)
      await update()
    } else if (word === 'panel-close') {
      if (chatId) setChatSession(chatId)
      S.isOpen = false
      await update()
    } else if (word.startsWith('chat:')) {
      S.isOpen = true
      S.isSideSet = false
      await update()
      setChatSession(word.slice(5))
      await update()
    } else if (word === 'panel') {
      S.isOpen = true
      S.isSideSet = false
      await update()
    } else if (word.startsWith('coreframes:')) {
      const [mode, pct] = word.slice(11).split('|')
      const c = document.createElement('canvas')
      c.width = P.N
      c.height = P.N
      for (let k = 0; k < 12; k++) {
        P.drawCore(c.getContext('2d'), mode, k, Number(pct))
        hud.writePng(`core-${mode}-${k}.png`, c.toDataURL('image/png'))
      }
    }
    await wait(380)
    await snap()
  } catch (err) {
    failure(err)
    hud.snap(null)
  }
})

// The box around every piece on show, with a margin.
async function snap() {
  const parts = [core, panel, chat, ...Object.values(cards)].filter(n => !n.hidden && n.offsetParent !== null)
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const n of parts) {
    const r = n.getBoundingClientRect()
    if (r.width === 0) continue
    x1 = Math.min(x1, r.left)
    y1 = Math.min(y1, r.top)
    x2 = Math.max(x2, r.right)
    y2 = Math.max(y2, r.bottom)
  }
  const pad = 16
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  hud.snap({ x: Math.max(0, Math.floor(x1 - pad)), y: Math.max(0, Math.floor(y1 - pad)), width: Math.ceil(x2 - x1 + pad * 2), height: Math.ceil(y2 - y1 + pad * 2) })
}

// ---------- start ----------

;(async () => {
  S.area = await hud.area()
  const prefs = await hud.prefs()
  setScale([2, 3, 4].includes(prefs.scale) ? prefs.scale : 2)
  if (prefs.left != null && prefs.top != null) {
    S.left = prefs.left
    S.top = prefs.top
  } else {
    const p = defaultPosition()
    S.left = p.left
    S.top = p.top
  }
  setCardSide()
  drawCore()
  await update()
  setInterval(update, 500)
})()
