// The panel: the account's usage, then a row per session. Each row leads with a small
// core in the big core's language, says what the session is doing, shows its context
// as ten cells (pressing them compacts), its share of the five-hour window, and a jump
// to the session in the app. Clicking a row opens its chat beside the panel.
'use strict'

function showUsage() {
  const box = $('usage')
  box.replaceChildren()
  if (S.account.length === 0) {
    box.append(el('div', 'usage-row', '사용량 기다리는 중'))
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
  const face = el('span', 'face', '▼ 압축')
  gaugeBox.append(gauge)
  const share = el('div', 'share')
  share.title = '이번 5시간 창에서 이 세션이 쓴 비중 (비용 비중으로 나눈 추정치)'
  meters.append(gaugeBox, share)
  const jump = el('div', 'jump', '↗')
  jump.title = '이 세션으로 이동'
  node.append(mini, text, meters, jump)
  const row = { id, node, mini, title, doing, gaugeBox, gauge, face, share, jump, view: null, state: 'idle', canCompact: true, ctx: null }

  node.addEventListener('click', () => setChatSession(id))
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
  row.canCompact = !(isBusy || isSent)
  const isOffered = row.gaugeBox.matches(':hover') && row.canCompact
  row.gaugeBox.classList.toggle('is-offered', isOffered)
  row.gaugeBox.classList.toggle('is-busy', isBusy)
  row.gaugeBox.style.cursor = row.canCompact ? 'pointer' : 'default'
  const want = isOffered ? row.face : row.gauge
  if (row.gaugeBox.firstChild !== want) row.gaugeBox.replaceChildren(want)
  const ctxText = s.ctx != null ? `컨텍스트 ${s.ctx}%` : '컨텍스트'
  row.gaugeBox.title = row.canCompact ? `${ctxText} · 눌러서 압축` : ctxText

  // Under the gauge: the compaction's progress when there is one, else the 5h share.
  row.share.title = '이번 5시간 창에서 이 세션이 쓴 비중 (비용 비중으로 나눈 추정치)'
  if (state === 'running') row.share.textContent = '압축 중…'
  else if (state === 'queued') row.share.innerHTML = '<b>끝나면 압축</b>'
  else if (state === 'submitted') row.share.innerHTML = '<b>곧 압축</b>'
  else if (isSent) row.share.textContent = '보냄'
  else if (isFailed) {
    row.share.innerHTML = '<b style="color:var(--danger)">압축 실패</b>'
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
    P.drawMiniState(row.mini.getContext('2d'), s.state, S.coreFrame >> 1)
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
    if (s.state === 'ask') {
      add('? ', 'Ask')
      add((s.data.question.questions || [])[0]?.question || '', 'Sub')
    } else if (s.state === 'working') {
      add(`${formatClock(s.elapsed)}  `, 'Sub', 'mono')
      if (w.current) {
        add(`${w.current.glyph} `, 'Accent')
        add(`${w.current.label} ${w.current.action} 중`, 'Muted')
      } else add('생각하는 중', 'Muted')
    } else if (s.state === 'done') {
      add('✓ 끝났어요', 'Done')
      if (w.edited > 0) add(`  ·  파일 ${w.edited}개 수정`, 'Muted')
    } else {
      add('대기', 'Faint')
      if (s.data.project) add(`  ·  ${s.data.project}`, 'Faint')
    }

    if (s.ctx != null && s.ctx !== row.ctx) {
      row.ctx = s.ctx
      P.drawGauge(row.gauge.getContext('2d'), s.ctx)
    }
    row.gauge.style.visibility = s.ctx != null ? 'visible' : 'hidden'
    updateRowButtons(row)
  }
  $('list-label').textContent = `세션 ${list.length}개  ·  눌러서 대화  ·  게이지 압축  ·  ↗ 이동`
}

// Turns the lamps of the cores that are lit: rows, the chat's, the question's.
function stepMinis() {
  const frame = S.coreFrame >> 1
  if (!panel.hidden) {
    for (const row of rows.values()) {
      if (row.state === 'working' || row.state === 'ask') P.drawMiniState(row.mini.getContext('2d'), row.state, frame)
    }
  }
  stepChatMini(frame)
  stepQuestionMini(frame)
}
