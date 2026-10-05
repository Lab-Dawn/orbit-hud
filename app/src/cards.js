// The cards that slide out of the core: the glance (hover), notices, and questions.
'use strict'

const QUESTION_INNER = 408
const OPTION_TEXT = 352

// ---------- the glance (hover) ----------

function showGlance(list) {
  const body = $('glance-body')
  body.replaceChildren()
  const inner = 368
  if (S.account.length === 0) body.append(P.pixelText(['사용량 기다리는 중', 'Muted']))
  for (const m of S.account) {
    const row = el('div', 'row')
    const left = el('div', 'grow')
    left.append(P.pixelText([[`${m.label} `, 'Muted'], [`${m.pct}%`, P.level(m.pct)]]))
    row.append(left)
    const reset = formatReset(m.resetsAt)
    if (reset) row.append(P.pixelText([reset, 'Faint']))
    body.append(row)
  }
  body.append(el('div', 'pixel-rule'))
  const active = list.filter(s => s.state !== 'idle')
  if (active.length === 0) body.append(P.pixelText([`세션 ${list.length}개 · 모두 대기 중`, 'Faint']))
  for (const s of active) {
    const when = s.state === 'working' ? [formatClock(s.elapsed), 'Sub'] : s.state === 'ask' ? ['질문', 'Ask'] : ['완료', 'Done']
    const right = P.pixelText(when)
    right.style.marginLeft = '8px'
    const row = el('div', 'row')
    const left = el('div', 'grow')
    left.append(P.pixelText([['● ', STATE_COLOR[s.state]], [s.title, 'Text']], { maxWidth: inner - parseFloat(right.style.width) - 8 }))
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
      const what = w.edited > 0 ? `파일 ${w.edited}개 수정` : `동작 ${w.actions}회`
      pushNotice('Done', `✓ ${s.title}`, `끝났어요 · ${formatClock(w.endedAt - w.startedAt)} · ${what}`, s.id, 'open', 6)
    }
    prevStates.set(s.id, s.state)
    const key = `ctx|${s.id}`
    if (s.ctx != null && s.ctx >= 85 && !warned.has(key)) {
      warned.add(key)
      pushNotice('Danger', `컨텍스트 ${s.ctx}% · ${s.title}`, '곧 자동 압축돼요. 눌러서 세션 열기', s.id, 'focus', 8)
    } else if (s.ctx != null && s.ctx < 80) warned.delete(key)
  }
  const five = S.account.find(m => m.short === '5h')
  if (five && five.resetsAt) {
    const key = `5h|${five.resetsAt}`
    if (five.pct >= 85 && !warned.has(key)) {
      warned.add(key)
      pushNotice('Danger', `5시간 사용량 ${five.pct}%`, `${formatReset(five.resetsAt)} · 눌러서 많이 쓴 세션 보기`, null, 'panel', 8)
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
  title.append(P.pixelText([n.head, n.color], { maxWidth: 480 }))
  const close = el('span', 'close-mark')
  close.title = '닫기'
  close.append(P.icon('close', 'Muted'))
  close.addEventListener('click', e => {
    e.stopPropagation()
    closeNotice()
  })
  head.append(title, close)
  body.append(head)
  const text = P.pixelText([n.body, 'Sub'], { maxWidth: 520, wrap: true })
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
  if (text) Q.errorBox.append(P.pixelText([text, 'Warn'], { maxWidth: QUESTION_INNER }))
  Q.errorBox.hidden = !text
}

function styleOption(item, option) {
  const isOn = item.selected.has(option.label)
  option.node.classList.toggle('is-on', isOn)
  option.mark.replaceWith((option.mark = markerCanvas(item.isMulti, isOn)))
  if (option.styled === isOn) return
  option.styled = isOn
  option.text.replaceChildren(P.pixelText([option.label, isOn ? 'Text' : 'Sub'], { maxWidth: OPTION_TEXT }))
  if (option.about) {
    const about = P.pixelText([option.about, 'Muted'], { maxWidth: OPTION_TEXT, wrap: true })
    about.classList.add('q-about')
    option.text.append(about)
  }
}

function newField(hint, onEnter) {
  const wrap = el('div', 'q-field')
  const input = el('input')
  input.type = 'text'
  input.spellcheck = false
  const hintNode = P.pixelText([hint, 'Faint'], { maxWidth: QUESTION_INNER - 24 })
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
  headText.append(P.pixelText([['질문', 'Ask'], [' · ', 'Faint'], [s.title, 'Sub']], { maxWidth: QUESTION_INNER - 70 }))
  const headRight = el('div', 'row')
  const jump = el('span', 'q-link')
  jump.title = '앱에서 이 세션 열기'
  jump.append(P.icon('jump', 'Muted'))
  jump.addEventListener('click', e => {
    e.stopPropagation()
    openApp(findSession(s.id))
  })
  head.append(mini, headText, headRight)

  const items = (qd.questions || []).map((qq, qi) => {
    const item = { question: String(qq.question), isMulti: !!qq.multiSelect, isChoice: true, options: [], selected: new Set(), field: null, fieldWrap: null, list: null, tag: null }
    if (qq.header) {
      item.tag = el('div', 'q-tag')
      item.tag.append(P.pixelText([[String(qq.header), 'Ask'], [qq.multiSelect ? ' · 여러 개' : '', 'Muted']], { maxWidth: QUESTION_INNER - 20 }))
    }
    item.text = P.pixelText([item.question, 'Text'], { maxWidth: QUESTION_INNER, wrap: true })
    item.text.classList.add('q-text')
    if (!item.tag) item.text.classList.add('is-first')
    const kind = qq.kind || 'choice'
    let hint = '직접 입력'
    if (kind === 'text' || kind === 'number') {
      item.isChoice = false
      hint = qq.placeholder ? String(qq.placeholder) : kind === 'number' ? `${qq.min ?? ''} ~ ${qq.max ?? ''} ${qq.unit ?? ''}`.trim() : '답을 입력하세요'
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
  Q = { key, sessionId: s.id, id: String(qd.id), items, page: 0, isSent: false, isOneTap, head, headRight, jump, mini, errorBox, error: '', others: 0 }
  for (const item of items) for (const option of item.options) styleOption(item, option)
  showQuestionPage()
}

function updateQuestionHead() {
  const q = Q
  q.headRight.replaceChildren()
  if (q.others > 0) {
    const more = P.pixelText([`+${q.others}`, 'Ask'])
    more.style.marginRight = '10px'
    more.title = `다른 세션의 질문 ${q.others}개가 기다리고 있어요`
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
  q.headRight.append(q.jump)
}

function showQuestionPage() {
  const q = Q
  const body = $('question-body')
  body.replaceChildren(q.head)
  updateQuestionHead()
  if (q.isSent) {
    P.drawMiniState(q.mini.getContext('2d'), 'done', 0)
    const done = P.pixelText(['✓ 답을 보냈어요', 'Done'])
    done.style.marginTop = '10px'
    body.append(done, P.pixelText(['세션이 이어서 작업해요', 'Muted']))
    cards.question.style.setProperty('--frame-edge', 'rgba(74,222,128,0.8)')
    return
  }
  const item = q.items[q.page]
  if (item.tag) body.append(item.tag)
  body.append(item.text)
  if (item.list) body.append(item.list)
  body.append(item.fieldWrap, q.errorBox)
  const foot = el('div', 'q-foot')
  const isLast = q.page === q.items.length - 1
  if (q.isOneTap) foot.append(P.pixelText(['고르면 바로 답해요', 'Faint']))
  else {
    const back = el('span', 'q-back')
    if (q.page > 0) {
      back.append(P.pixelText(['← 이전', 'Muted']))
      back.addEventListener('click', e => {
        e.stopPropagation()
        questionAction('back')
      })
    }
    const go = el('div', 'q-button')
    go.append(P.pixelText([isLast ? '답하기' : '다음 →', 'Text']))
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
    setQuestionError('고르거나 입력해 주세요')
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
      setQuestionError('고르거나 입력해 주세요')
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
