// The panel: the account's usage, then a row per session. Each row leads with a small
// core in the big core's language, says what the session is doing, shows its context
// as ten cells (pressing them compacts), its share of the five-hour window, and a jump
// to the session in the app. Clicking a row opens its chat beside the panel.
'use strict'

function showUsage() {
  const box = $('usage')
  box.replaceChildren()
  if (S.account.length === 0) {
    box.append(el('div', 'usage-row', tr('usage.waiting')))
    return
  }
  for (const m of S.account) {
    const row = el('div', 'usage-row')
    const what = el('span', 'what', `${m.label} `)
    const pct = el('span', 'pct', `${m.pct}%`)
    pct.style.color = P.COLORS[P.level(m.pct)]
    what.append(pct)
    row.append(what, el('span', 'note', formatReset(m.resetsAt)))
    box.append(row)
  }
}

const rows = new Map()
let sentId = null
let sentAt = 0

function newRow(id) {
  const node = el('div', 's-row')
  const mini = P.pixelCanvas(P.MINI, P.MINI, 2)
  mini.classList.add('mini')
  const text = el('div', 'text')
  const title = el('div', 'title')
  const doing = el('div', 'doing')
  text.append(title, doing)
  const meters = el('div', 'meters')
  const gaugeBox = el('div', 'gauge-box')
  const gauge = P.pixelCanvas(P.GAUGE_W, P.GAUGE_H, 2)
  const face = el('span', 'face', tr('panel.compactFace'))
  gaugeBox.append(gauge)
  const share = el('div', 'share')
  share.title = tr('panel.shareTip')
  meters.append(gaugeBox, share)
  const jump = el('div', 'jump', '↗')
  jump.title = tr('panel.jumpTip')
  node.append(mini, text, meters, jump)
  mini.addEventListener('mouseenter', () => showCacheTip(row))
  mini.addEventListener('mouseleave', hideCacheTip)
  const row = { id, node, mini, title, doing, gaugeBox, gauge, face, share, jump, view: null, state: 'idle', canCompact: true, ctx: null }

  // A session the plugin is not in has no chat to open.
  node.addEventListener('click', () => {
    if (!row.view || !row.view.isLite) setChatSession(id)
  })
  jump.addEventListener('click', e => {
    e.stopPropagation()
    if (row.view) openApp(row.view)
  })
  gaugeBox.addEventListener('click', e => {
    e.stopPropagation()
    pressCompact(id)
  })
  gaugeBox.addEventListener('mouseenter', () => updateRowButtons(row))
  gaugeBox.addEventListener('mouseleave', () => updateRowButtons(row))
  return row
}

// The context gauge is also the compact button: hovering turns it into one, a press sends it.
function pressCompact(id) {
  const row = rows.get(id)
  if (!row || !row.canCompact) return
  hud.writeFile(`commands/${id}.json`, JSON.stringify({ action: 'compact', id: crypto.randomUUID() }))
  sentId = id
  sentAt = Date.now()
  updateRowButtons(row)
}

function updateRowButtons(row) {
  const s = row.view
  if (!s) return
  row.jump.classList.toggle('is-off', !s.appId)
  const state = s.data.compact
  const isSent = sentId === s.id && Date.now() - sentAt < 3000
  const failure = s.data.compactError
  const isFailed = failure && s.data.writtenAt - failure.at < 20000
  const isBusy = state === 'running' || state === 'queued' || state === 'submitted'
  row.canCompact = !(isBusy || isSent || s.isLite)
  const isOffered = row.gaugeBox.matches(':hover') && row.canCompact
  row.gaugeBox.classList.toggle('is-offered', isOffered)
  row.gaugeBox.classList.toggle('is-busy', isBusy)
  row.gaugeBox.style.cursor = row.canCompact ? 'pointer' : 'default'
  const want = isOffered ? row.face : row.gauge
  if (row.gaugeBox.firstChild !== want) row.gaugeBox.replaceChildren(want)
  const ctxText = s.ctx != null ? `${tr('usage.ctx')} ${s.ctx}%` : tr('usage.ctx')
  row.gaugeBox.title = row.canCompact ? tr('panel.compactTip', { ctx: ctxText }) : ctxText

  // Under the gauge: the compaction's progress when there is one, else the 5h share.
  row.share.title = tr('panel.shareTip')
  if (state === 'running') row.share.textContent = tr('panel.compacting')
  else if (state === 'queued') row.share.replaceChildren(el('b', null, tr('panel.compactQueued')))
  else if (state === 'submitted') row.share.replaceChildren(el('b', null, tr('panel.compactSoon')))
  else if (isSent) row.share.textContent = tr('panel.sent')
  else if (isFailed) {
    const b = el('b', null, tr('panel.compactFailed'))
    b.style.color = 'var(--danger)'
    row.share.replaceChildren(b)
    row.share.title = String(failure.message)
  } else if (s.windowPct != null) {
    row.share.replaceChildren(document.createTextNode('5h '), el('b', null, formatShare(s.windowPct, s.isPartial)))
  } else row.share.textContent = ''
}

function updateSessionList(list) {
  const box = $('sessions')
  const alive = new Set(list.map(s => s.id))
  for (const [id, row] of rows) {
    if (!alive.has(id)) {
      if (cacheTip.row === row) hideCacheTip()
      row.node.remove()
      rows.delete(id)
    }
  }
  for (const s of list) {
    if (!rows.has(s.id)) {
      const row = newRow(s.id)
      rows.set(s.id, row)
      box.append(row.node)
    }
    const row = rows.get(s.id)
    row.view = s
    row.state = s.state
    row.node.classList.toggle('is-chat', s.id === chatId)
    P.drawMiniState(row.mini.getContext('2d'), s.state, S.coreFrame >> 1, miniCache(s))
    row.title.textContent = s.title
    row.title.style.color = s.state === 'idle' ? 'var(--sub)' : 'var(--text)'

    // One line: what the session is doing right now.
    const w = s.data.work
    row.doing.replaceChildren()
    const add = (text, color, cls) => {
      const span = el('span', cls, text)
      if (color) span.style.color = P.COLORS[color]
      row.doing.append(span)
    }
    row.doing.title = ''
    if (s.isLite) {
      // Known from its transcript alone: the plugin is not running in that session.
      if (s.state === 'working') add(tr('chat.working'), 'Muted')
      else add(tr('panel.activeAgo', { ago: formatAgo(Date.now() - s.lastAt) }), 'Faint')
      add(`  ·  ${tr('panel.notLinked')}`, 'Faint')
      row.doing.title = tr('panel.liteTip')
    } else if (s.state === 'ask') {
      add('? ', 'Ask')
      add((s.data.question.questions || [])[0]?.question || '', 'Sub')
    } else if (s.state === 'working') {
      add(`${formatClock(s.elapsed)}  `, 'Sub', 'mono')
      if (w.current) {
        add(`${w.current.glyph} `, 'Accent')
        add(w.current.kind ? tr(`act.${w.current.kind}`, { label: w.current.label }) : `${w.current.label} ${w.current.action}`, 'Muted')
      } else add(tr('panel.thinking'), 'Muted')
    } else if (s.state === 'done') {
      add(tr('panel.done'), 'Done')
      if (w.edited > 0) add(`  ·  ${tr('work.edited', { n: w.edited })}`, 'Muted')
    } else {
      add(tr('panel.idle'), 'Faint')
      if (s.data.project) add(`  ·  ${s.data.project}`, 'Faint')
    }

    showCache(row)

    if (s.ctx != null && s.ctx !== row.ctx) {
      row.ctx = s.ctx
      P.drawGauge(row.gauge.getContext('2d'), s.ctx)
    }
    row.gauge.style.visibility = s.ctx != null ? 'visible' : 'hidden'
    updateRowButtons(row)
  }
  $('list-label').textContent = tr('panel.listLabel', { n: list.length })
}

// The prompt cache shows on the row's core: amber in the last fifth of its time to
// live, grey once cold. Hovering the core tells what that means.
function miniCache(s) {
  const c = cacheState(s)
  return c && (c.state === 'low' || c.state === 'cold') ? c.state : null
}

function showCache(row) {
  if (cacheTip.row === row) showCacheTip(row)
}

const cacheTip = { node: null, row: null }

function showCacheTip(row) {
  const s = row.view
  const c = s && cacheState(s)
  if (!c) return hideCacheTip()
  if (!cacheTip.node) {
    cacheTip.node = el('div', 'cache-tip')
    panel.append(cacheTip.node)
  }
  cacheTip.row = row
  const box = cacheTip.node
  box.replaceChildren()
  const line = (cls, ...parts) => {
    const d = el('div', cls)
    for (const [text, color] of parts) {
      const span = el('span', null, text)
      if (color) span.style.color = `var(--${color})`
      d.append(span)
    }
    box.append(d)
    return d
  }
  const ctx = (s.data.usage || []).find(m => m.short === 'ctx')
  const color = { live: 'done', warm: 'done', low: 'warn', cold: 'danger' }[c.state]
  const remain = formatLeft(c.left)
  const now = { live: tr('cache.live'), warm: tr('cache.warm', { left: remain }), low: tr('cache.low', { left: remain }), cold: tr('cache.cold') }[c.state]
  line('head', [`${tr('cache.title')}  `, 'sub'], [now, color])
  const say = {
    live: tr('cache.sayLive'),
    warm: tr('cache.sayWarm', { ttl: c.ttl }),
    low: tr('cache.sayLow', { left: remain }),
    cold: tr('cache.sayCold', { what: ctx && ctx.tokens ? tr('cache.whatTokens', { tokens: formatTokens(ctx.tokens) }) : tr('cache.whatAll') }),
  }[c.state]
  line('say', [say, 'muted'])
  const stats = [tr('cache.ttl', { ttl: c.ttl })]
  if (c.hitRatio != null) stats.push(tr('cache.hit', { pct: Math.round(c.hitRatio * 100) }))
  stats.push(tr('cache.requests', { n: c.requests }), tr('cache.misses', { n: c.misses }))
  line('stats', [stats.join('  ·  '), 'faint'])
  // The core keeps its own color while the cache holds; only the two warnings need a key.
  const key = line('key', [tr('cache.key'), null])
  for (const [hue, label] of [['amber', tr('cache.keyLow')], ['gray', tr('cache.keyCold')]]) {
    const sw = el('i', `sw sw--${hue}`)
    key.append(sw, el('span', null, label))
  }

  const pr = panel.getBoundingClientRect()
  const mr = row.mini.getBoundingClientRect()
  const left = mr.right - pr.left + 6
  let top = mr.bottom - pr.top + 4
  box.hidden = false
  if (top + box.offsetHeight > pr.height - 8) top = mr.top - pr.top - box.offsetHeight - 4
  box.style.left = `${left}px`
  box.style.top = `${top}px`
}

function hideCacheTip() {
  cacheTip.row = null
  if (cacheTip.node) cacheTip.node.hidden = true
}

// Turns the lamps of the cores that are lit: rows, the chat's, the question's.
function stepMinis() {
  const frame = S.coreFrame >> 1
  if (!panel.hidden) {
    for (const row of rows.values()) {
      if (row.state === 'working' || row.state === 'ask') P.drawMiniState(row.mini.getContext('2d'), row.state, frame, row.view && miniCache(row.view))
    }
  }
  stepChatMini(frame)
  stepQuestionMini(frame)
}
