// The cards that slide out of the core: the glance (hover), notices, and questions.
'use strict'

const QUESTION_INNER = 408
const OPTION_TEXT = 352
// The question card reads in the smaller lettering, so a long question still fits on screen.
const SMALL = { size: 'small' }

// ---------- the glance (hover) ----------

function showGlance(list) {
  const body = $('glance-body')
  body.replaceChildren()
  const inner = 358
  const small = { size: 'small' }
  if (S.account.length === 0) body.append(P.pixelText([tr('usage.waiting'), 'Muted'], small))
  for (const m of S.account) {
    const row = el('div', 'row')
    const left = el('div', 'grow')
    left.append(P.pixelText([[`${m.label} `, 'Muted'], [`${m.pct}%`, P.level(m.pct)]], small))
    row.append(left)
    const reset = formatReset(m.resetsAt)
    if (reset) row.append(P.pixelText([reset, 'Faint'], small))
    body.append(row)
  }
  body.append(el('div', 'pixel-rule'))
  const active = list.filter(s => s.state !== 'idle')
  if (active.length === 0) body.append(P.pixelText([tr('glance.allIdle', { n: list.length }), 'Faint'], small))
  for (const s of active) {
    const when = s.state === 'working' ? [formatClock(s.elapsed), 'Sub'] : s.state === 'ask' ? [tr('state.ask'), 'Ask'] : [tr('state.done'), 'Done']
    const right = P.pixelText(when, small)
    right.style.marginLeft = '8px'
    const row = el('div', 'row')
    const left = el('div', 'grow')
    left.append(P.pixelText([['• ', STATE_COLOR[s.state]], [s.title, 'Text']], { ...small, maxWidth: inner - parseFloat(right.style.width) - 8 }))
    row.append(left, right)
    body.append(row)
  }
}

// ---------- notices: a finished task, a limit running out; each shows a few seconds ----------

const prevStates = new Map()
const warned = new Set()
const notices = []
let notice = null

function pushNotice(color, head, body, sessionId, action, seconds) {
  notices.push({ color, head, body, sessionId, action, seconds })
}

// Turns changes between ticks into notices: a session that stops working has finished;
// the 5h limit or a session's context crossing 85% is worth a word, once per crossing.
function watchEvents(list) {
  for (const s of list) {
    const prev = prevStates.get(s.id)
    if (prev === 'working' && (s.state === 'done' || s.state === 'idle')) {
      const w = s.data.work
      const what = w.edited > 0 ? tr('work.edited', { n: w.edited }) : tr('work.actions', { n: w.actions })
      pushNotice('Done', `✓ ${s.title}`, tr('notice.doneBody', { time: formatClock(w.endedAt - w.startedAt), what }), s.id, 'open', 6)
    }
    prevStates.set(s.id, s.state)
    const key = `ctx|${s.id}`
    if (s.ctx != null && s.ctx >= 85 && !warned.has(key)) {
      warned.add(key)
      pushNotice('Danger', tr('notice.ctxHead', { pct: s.ctx, title: s.title }), tr('notice.ctxBody'), s.id, 'focus', 8)
    } else if (s.ctx != null && s.ctx < 80) warned.delete(key)
  }
  const five = S.account.find(m => m.short === '5h')
  if (five && five.resetsAt) {
    const key = `5h|${five.resetsAt}`
    if (five.pct >= 85 && !warned.has(key)) {
      warned.add(key)
      pushNotice('Danger', tr('notice.fiveHead', { pct: five.pct }), tr('notice.fiveBody', { reset: formatReset(five.resetsAt) }), null, 'panel', 8)
    }
  }
}

function updateNotice() {
  const card = cards.notice
  const now = Date.now()
  if (notice && now >= notice.until && (notice.isDismissed || !card.matches(':hover'))) {
    notice = null
    hideCard(card)
  }
  if (notice || notices.length === 0 || card.dataset.state === 'out') return
  const n = notices.shift()
  n.until = now + n.seconds * 1000
  notice = n
  const body = $('notice-body')
  body.replaceChildren()
  const head = el('div', 'row')
  const title = el('div', 'grow')
  // The glance's smaller lettering: a notice is read at a look too.
  const small = { size: 'small' }
  title.append(P.pixelText([n.head, n.color], { ...small, maxWidth: 480 }))
  const close = el('span', 'close-mark')
  close.title = tr('close')
  close.append(P.icon('close', 'Muted'))
  close.addEventListener('click', e => {
    e.stopPropagation()
    closeNotice()
  })
  head.append(title, close)
  body.append(head)
  const text = P.pixelText([n.body, 'Sub'], { ...small, maxWidth: 520, wrap: true })
  text.style.marginTop = '2px'
  body.append(text)
  const edge = { Done: 'rgba(74,222,128,0.8)', Danger: 'rgba(255,92,108,0.8)' }[n.color] || 'rgba(92,225,245,0.6)'
  card.style.setProperty('--frame-edge', edge)
  showCard(card)
}

function closeNotice() {
  if (!notice) return
  notice.until = 0
  notice.isDismissed = true
  update()
}

cards.notice.addEventListener('click', () => {
  const n = notice
  if (!n) return
  closeNotice()
  if (n.action === 'open') openApp(findSession(n.sessionId))
  else if (n.action === 'focus') {
    S.focusId = n.sessionId
    S.isOpen = true
    S.isSideSet = false
    update()
  } else if (n.action === 'panel') {
    S.isOpen = true
    S.isSideSet = false
    update()
  }
})

// ---------- questions: Claude's AskUserQuestion, answered from a card ----------
// One question to a page, in the asking violet with square pixel edges. A tap picks an
// option; on a single-choice page that also moves on (or, for a lone question, answers
// it). Typed text stands in for the options.

let Q = null

function markerCanvas(isMulti, isOn) {
  const c = P.pixelCanvas(7, 7, 2)
  P.drawMarker(c.getContext('2d'), isMulti, isOn)
  return c
}

function isAnswered(item) {
  return (item.field && item.field.value.trim()) || item.selected.size > 0
}

function setQuestionError(text) {
  if (!Q || Q.error === text) return
  Q.error = text
  Q.errorBox.replaceChildren()
  if (text) Q.errorBox.append(P.pixelText([text, 'Warn'], { size: 'small', maxWidth: QUESTION_INNER }))
  Q.errorBox.hidden = !text
}

function styleOption(item, option) {
  const isOn = item.selected.has(option.label)
  option.node.classList.toggle('is-on', isOn)
  option.mark.replaceWith((option.mark = markerCanvas(item.isMulti, isOn)))
  if (option.styled === isOn) return
  option.styled = isOn
  option.text.replaceChildren(P.pixelText([option.label, isOn ? 'Text' : 'Sub'], { size: 'small', maxWidth: OPTION_TEXT, wrap: true }))
  if (option.about) {
    const about = P.pixelText([option.about, 'Muted'], { size: 'small', maxWidth: OPTION_TEXT, wrap: true })
    about.classList.add('q-about')
    option.text.append(about)
  }
}

function newField(hint, onEnter) {
  const wrap = el('div', 'q-field')
  const input = el('input')
  input.type = 'text'
  input.spellcheck = false
  const hintNode = P.pixelText([hint, 'Faint'], { size: 'small', maxWidth: QUESTION_INNER - 24 })
  hintNode.classList.add('hint')
  input.addEventListener('input', () => {
    hintNode.hidden = !!input.value
    setQuestionError('')
  })
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onEnter()
    }
  })
  wrap.append(input, hintNode)
  return { wrap, input }
}

function buildQuestion(s, key) {
  const qd = s.data.question
  cards.question.style.setProperty('--frame-edge', 'rgba(180,155,255,0.8)')
  const head = el('div', 'q-head')
  const mini = P.pixelCanvas(P.MINI, P.MINI, 2)
  const headText = el('div', 'grow')
  headText.append(P.pixelText([[tr('q.title'), 'Ask'], [' · ', 'Faint'], [s.title, 'Sub']], { size: 'small', maxWidth: QUESTION_INNER - 110 }))
  const headRight = el('div', 'row')
  // To answer in the app instead: jump there (the card folds out of the way), or
  // just fold it down to its head line; the head unfolds it again.
  const jump = el('span', 'q-btn')
  jump.title = tr('q.openInApp')
  jump.append(P.icon('jump', 'Muted'))
  jump.hidden = !s.appId
  jump.addEventListener('click', e => {
    e.stopPropagation()
    openApp(findSession(s.id))
    setQuestionFolded(true)
  })
  const fold = el('span', 'q-btn')
  fold.addEventListener('click', e => {
    e.stopPropagation()
    setQuestionFolded(!Q.isFolded)
  })
  head.addEventListener('click', () => {
    if (Q && Q.isFolded) setQuestionFolded(false)
  })
  head.append(mini, headText, headRight)

  const items = (qd.questions || []).map((qq, qi) => {
    const item = { question: String(qq.question), isMulti: !!qq.multiSelect, isChoice: true, options: [], selected: new Set(), field: null, fieldWrap: null, list: null, tag: null }
    if (qq.header) {
      item.tag = el('div', 'q-tag')
      item.tag.append(P.pixelText([[String(qq.header), 'Ask'], [qq.multiSelect ? tr('q.multi') : '', 'Muted']], { size: 'small', maxWidth: QUESTION_INNER - 20 }))
    }
    item.text = P.pixelText([item.question, 'Text'], { size: 'small', maxWidth: QUESTION_INNER, wrap: true })
    item.text.classList.add('q-text')
    if (!item.tag) item.text.classList.add('is-first')
    const kind = qq.kind || 'choice'
    let hint = tr('q.typeOwn')
    if (kind === 'text' || kind === 'number') {
      item.isChoice = false
      hint = qq.placeholder ? String(qq.placeholder) : kind === 'number' ? `${qq.min ?? ''} ~ ${qq.max ?? ''} ${qq.unit ?? ''}`.trim() : tr('q.typeAnswer')
    } else {
      item.list = el('div')
      ;(qq.options || []).forEach((o, oi) => {
        const node = el('div', 'q-option')
        const mark = markerCanvas(item.isMulti, false)
        const text = el('div', 'grow')
        node.append(mark, text)
        const option = { label: String(o.label), about: o.description ? String(o.description) : '', node, mark, text, styled: null }
        node.addEventListener('click', e => {
          e.stopPropagation()
          selectOption(qi, oi)
        })
        item.options.push(option)
        item.list.append(node)
      })
    }
    const field = newField(hint, () => questionAction('next'))
    item.field = field.input
    item.fieldWrap = field.wrap
    return item
  })

  const errorBox = el('div', 'q-error')
  errorBox.hidden = true
  const isOneTap = items.length === 1 && items[0].isChoice && !items[0].isMulti
  Q = { key, sessionId: s.id, id: String(qd.id), items, page: 0, isSent: false, isOneTap, head, headRight, jump, fold, isFolded: false, mini, errorBox, error: '', others: 0 }
  for (const item of items) for (const option of item.options) styleOption(item, option)
  showQuestionPage()
}

function updateQuestionHead() {
  const q = Q
  q.headRight.replaceChildren()
  if (q.others > 0) {
    const more = P.pixelText([`+${q.others}`, 'Ask'], SMALL)
    more.style.marginRight = '10px'
    more.title = tr('q.others', { n: q.others })
    q.headRight.append(more)
  }
  if (q.items.length > 1 && !q.isSent) {
    const dots = el('div', 'q-dots')
    q.items.forEach((item, i) => {
      const dot = el('i')
      if (i === q.page) dot.className = 'is-now'
      else if (isAnswered(item)) dot.className = 'is-done'
      dots.append(dot)
    })
    q.headRight.append(dots)
  }
  q.fold.replaceChildren(P.icon(q.isFolded ? 'unfold' : 'fold', 'Muted'))
  q.fold.title = tr(q.isFolded ? 'q.unfold' : 'q.fold')
  q.headRight.append(q.jump)
  if (!q.isSent) q.headRight.append(q.fold)
}

// Folding rolls the card up over its content and leaves the head line; unfolding
// rolls it back down. The cards follow the card's height frame by frame, so the edge
// by the core stays put and the head glides.
function setQuestionFolded(isFolded) {
  const q = Q
  if (!q || q.isFolded === isFolded || q.isRolling) return
  const body = $('question-body')
  const from = body.offsetHeight
  if (isFolded) {
    const pad = parseFloat(getComputedStyle(body).paddingTop) + parseFloat(getComputedStyle(body).paddingBottom)
    rollQuestion(q, from, q.head.offsetHeight + pad, () => {
      q.isFolded = true
      showQuestionPage()
    })
  } else {
    q.isFolded = false
    showQuestionPage()
    rollQuestion(q, from, body.offsetHeight)
  }
}

function rollQuestion(q, from, to, done) {
  const body = $('question-body')
  q.isRolling = true
  body.style.boxSizing = 'border-box'
  body.style.overflow = 'hidden'
  const roll = body.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' })
  const follow = () => {
    layout()
    if (q.isRolling) requestAnimationFrame(follow)
  }
  requestAnimationFrame(follow)
  roll.onfinish = () => {
    q.isRolling = false
    if (done && Q === q) done()
    roll.cancel()
    body.style.boxSizing = ''
    body.style.overflow = ''
    layout()
  }
}

function showQuestionPage() {
  const q = Q
  const body = $('question-body')
  body.replaceChildren(q.head)
  updateQuestionHead()
  q.head.classList.toggle('is-folded', q.isFolded && !q.isSent)
  if (q.isFolded && !q.isSent) return
  if (q.isSent) {
    P.drawMiniState(q.mini.getContext('2d'), 'done', 0)
    const done = P.pixelText([tr('q.sent'), 'Done'], SMALL)
    done.style.marginTop = '10px'
    body.append(done, P.pixelText([tr('q.continues'), 'Muted'], SMALL))
    cards.question.style.setProperty('--frame-edge', 'rgba(74,222,128,0.8)')
    return
  }
  // The question and its options scroll when they are taller than the screen allows;
  // the head and the answer button stay in sight.
  const item = q.items[q.page]
  const scroll = el('div', 'q-scroll')
  if (item.tag) scroll.append(item.tag)
  scroll.append(item.text)
  if (item.list) scroll.append(item.list)
  scroll.append(item.fieldWrap, q.errorBox)
  body.append(scroll)
  const foot = el('div', 'q-foot')
  const isLast = q.page === q.items.length - 1
  if (q.isOneTap) foot.append(P.pixelText([tr('q.oneTap'), 'Faint'], SMALL))
  else {
    const back = el('span', 'q-back')
    if (q.page > 0) {
      back.append(P.pixelText([tr('q.back'), 'Muted'], SMALL))
      back.addEventListener('click', e => {
        e.stopPropagation()
        questionAction('back')
      })
    }
    const go = el('div', 'q-button')
    go.append(P.pixelText([isLast ? tr('q.answer') : tr('q.next'), 'Text'], SMALL))
    go.addEventListener('click', e => {
      e.stopPropagation()
      questionAction('next')
    })
    foot.append(back, go)
  }
  body.append(foot)
}

// The question card follows whichever session is asking; it slides back once answered.
function updateQuestion(list) {
  const askers = list.filter(s => s.state === 'ask')
  if (askers.length === 0) {
    hideCard(cards.question)
    Q = null
    return
  }
  // Stay on the question in hand while another session asks too.
  const asking = (Q && askers.find(s => s.id === Q.sessionId)) || askers[0]
  const key = `${asking.id}|${asking.data.question.id}`
  if (!Q || Q.key !== key) buildQuestion(asking, key)
  const others = askers.length - 1
  if (Q.others !== others) {
    Q.others = others
    updateQuestionHead()
  }
  // The app's own session may be found only after the card is built.
  Q.jump.hidden = !asking.appId
  showCard(cards.question)
}

function selectOption(qi, oi) {
  const q = Q
  if (!q || q.isSent) return
  const item = q.items[qi]
  const label = item.options[oi].label
  if (item.isMulti) {
    if (item.selected.has(label)) item.selected.delete(label)
    else item.selected.add(label)
  } else {
    item.selected.clear()
    item.selected.add(label)
  }
  for (const option of item.options) styleOption(item, option)
  setQuestionError('')
  updateQuestionHead()
  if (item.isMulti || item.field.value.trim()) return
  // A single choice settles the page: answer a lone question, or turn to the next one.
  if (q.isOneTap) {
    submitAnswer()
    return
  }
  if (q.page < q.items.length - 1) {
    const key = q.key
    setTimeout(() => {
      if (Q && Q.key === key && !Q.isSent) {
        Q.page += 1
        showQuestionPage()
        layout()
      }
    }, 220)
  }
}

// next: on to the next page once this one is answered, or send from the last;
// back: the page before.
function questionAction(action) {
  const q = Q
  if (!q || q.isSent) return
  if (action === 'back') {
    if (q.page > 0) {
      q.page -= 1
      setQuestionError('')
      showQuestionPage()
      layout()
    }
    return
  }
  if (!isAnswered(q.items[q.page])) {
    setQuestionError(tr('q.required'))
    return
  }
  if (q.page < q.items.length - 1) {
    q.page += 1
    setQuestionError('')
    showQuestionPage()
    layout()
    return
  }
  submitAnswer()
}

// Typed text wins over chosen options; every question needs one or the other.
function submitAnswer() {
  const q = Q
  if (!q || q.isSent) return
  const answers = {}
  for (let i = 0; i < q.items.length; i++) {
    const item = q.items[i]
    const typed = item.field ? item.field.value.trim() : ''
    if (typed) answers[item.question] = typed
    else if (item.selected.size > 0) answers[item.question] = [...item.selected].join(', ')
    else {
      q.page = i
      showQuestionPage()
      setQuestionError(tr('q.required'))
      return
    }
  }
  hud.writeFile(`answers/${q.sessionId}.json`, JSON.stringify({ questionId: q.id, answers }))
  q.isSent = true
  showQuestionPage()
  layout()
}

function stepQuestionMini(frame) {
  if (Q && !Q.isSent && !cards.question.hidden) P.drawMiniState(Q.mini.getContext('2d'), 'ask', frame)
}
