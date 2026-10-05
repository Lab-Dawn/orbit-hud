// The chat card: a session's recent conversation beside the panel, and a line to
// prompt it. The plugin writes the conversation only while the chat is open: the
// widget keeps touching a watch file.
'use strict'

let chatId = null
let chatStamp = 0
let chatData = null
let chatReadAt = 0
let chatWatchAt = 0
const chatLines = $('chat-lines')
const chatText = $('chat-text')
const chatStatus = $('chat-status')
const chatMini = $('chat-mini')
chatMini.width = P.MINI
chatMini.height = P.MINI

$('chat-close').append(P.icon('close', 'Muted'))
const arrow = P.pixelCanvas(7, 8, 2)
P.drawArrow(arrow.getContext('2d'))
$('chat-send').append(arrow)
$('chat-send').addEventListener('click', e => {
  e.stopPropagation()
  sendChat()
})
$('chat-close').addEventListener('click', e => {
  e.stopPropagation()
  setChatSession(chatId)
})
chat.addEventListener('click', e => e.stopPropagation())

// Enter sends, Shift+Enter breaks the line, Esc closes; the field grows to four lines.
chatText.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    sendChat()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    setChatSession(chatId)
  }
})
chatText.addEventListener('input', () => {
  chatText.style.height = 'auto'
  chatText.style.height = `${Math.min(80, chatText.scrollHeight + 4)}px`
})

function setChatStatus(text, color = 'Faint') {
  chatStatus.textContent = text
  chatStatus.style.color = P.COLORS[color]
  chatStatus.title = text
  chatStatus.hidden = !text
}

// Tool calls fold into one dim line: "› Read ×3 · Edit".
function formatTools(tools) {
  const counts = new Map()
  for (const t of tools || []) counts.set(t, (counts.get(t) || 0) + 1)
  return `› ${[...counts].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(' · ')}`
}

// ---------- outgoing prompts: shown at once as sent, delivered one at a time ----------
// Each session has a small outbox. A prompt shows in the chat the moment it is typed;
// the widget hands the plugin one at a time through the session's prompt file, and
// only while the session is free, so one still waiting can be taken back.

const outboxes = new Map()
const prefixOf = text => text.slice(0, 60)
const userCount = (data, prefix) => (data ? (data.lines || []).filter(l => l.role === 'user' && String(l.text).startsWith(prefix)).length : 0)

// The conversation carries a prompt once there are more lines like it than when it
// went out, or the newest line from the person is it.
function isDelivered(item, data) {
  if (!data || item.state !== 'taken') return false
  if (userCount(data, item.prefix) > item.baseline) return true
  const users = (data.lines || []).filter(l => l.role === 'user')
  const last = users[users.length - 1]
  return !!last && String(last.text).startsWith(item.prefix) && chatReadAt > item.at
}

function showChat() {
  if (!chatId) return
  const data = chatData
  const atEnd = chatLines.scrollTop >= chatLines.scrollHeight - chatLines.clientHeight - 4
  chatLines.replaceChildren()
  const box = outboxes.get(chatId)
  if (box) for (const item of [...box]) if (isDelivered(item, data)) box.splice(box.indexOf(item), 1)
  const lines = data ? data.lines || [] : []
  if (!data && !(box && box.length)) chatLines.append(el('div', 'msg-empty', '불러오는 중…'))
  else if (lines.length === 0 && !(box && box.length)) chatLines.append(el('div', 'msg-empty', '아직 대화가 없어요'))
  for (const l of lines) {
    if (l.role === 'user') chatLines.append(el('div', 'msg-user', String(l.text)))
    else if (l.role === 'assistant') chatLines.append(el('div', 'msg-ai', String(l.text)))
    else if (l.role === 'tools') chatLines.append(el('div', 'msg-tools', formatTools(l.tools)))
  }
  if (box) {
    for (const item of box) {
      const bubble = el('div', 'msg-user is-pending', item.text)
      chatLines.append(bubble)
      if (item.state === 'queued') {
        const note = el('div', 'msg-note')
        note.append(el('span', null, '대기 중 · 작업이 끝나면 보내요'))
        const cancel = el('span', 'cancel', '취소')
        cancel.title = '보내지 않고 지우기'
        cancel.addEventListener('click', e => {
          e.stopPropagation()
          removeOutgoing(item.id)
        })
        note.append(cancel)
        chatLines.append(note)
      }
    }
  }
  const row = rows.get(chatId)
  const isActive = (data && data.isActive) || (row && row.state === 'working')
  if (isActive || (box && box.length)) {
    const loader = el('div', 'loader')
    loader.append(el('i'), el('i'), el('i'))
    if (isActive) loader.append(document.createTextNode('작업 중'))
    chatLines.append(loader)
  }
  if (atEnd || !chatStamp) chatLines.scrollTop = chatLines.scrollHeight
}

// Takes back a prompt the widget still holds; one already handed over has gone in.
function removeOutgoing(itemId) {
  const box = outboxes.get(chatId)
  if (!box) return
  const i = box.findIndex(x => x.id === itemId && x.state === 'queued')
  if (i >= 0) box.splice(i, 1)
  if (box.length === 0) outboxes.delete(chatId)
  showChat()
}

// Every tick: hand each session's next prompt over once its prompt file is free and
// the session is not busy.
async function sendOutboxes() {
  const now = Date.now()
  let changed = false
  for (const [sid, box] of [...outboxes]) {
    const text = ((await hud.readFile(`prompts/${sid}.json`)) || '').trim()
    const isFree = text === '' || text === '{}'
    for (const item of [...box]) {
      if (item.state === 'sent') {
        if (isFree) {
          item.state = 'taken'
          item.at = now
          changed = true
        } else if (now - item.at > 15000) {
          box.splice(box.indexOf(item), 1)
          changed = true
          if (sid === chatId) setChatStatus('세션이 받지 않았어요 · 플러그인이 다시 불러와지는 중일 수 있어요', 'Warn')
        }
      } else if (item.state === 'taken' && now - item.at > 600000) {
        box.splice(box.indexOf(item), 1)
        changed = true
      }
    }
    const isHanded = box.some(x => x.state === 'sent')
    const session = findSession(sid)
    const isBusy = session && (session.state === 'working' || session.state === 'ask')
    const isInFlight = box.some(x => x.state === 'taken' && now - x.at < 4000)
    if (isFree && !isHanded && !isBusy && !isInFlight) {
      const next = box.find(x => x.state === 'queued')
      if (next) {
        hud.writeFile(`prompts/${sid}.json`, JSON.stringify({ id: next.id, text: next.text }))
        next.state = 'sent'
        next.at = now
        changed = true
      }
    }
    if (box.length === 0) outboxes.delete(sid)
  }
  if (changed && chatId) showChat()
}

function sendChat() {
  const text = chatText.value.trim()
  const id = chatId
  if (!text || !id) return
  if (!outboxes.has(id)) outboxes.set(id, [])
  const prefix = prefixOf(text)
  outboxes.get(id).push({ id: crypto.randomUUID(), text, prefix, baseline: userCount(chatData, prefix), state: 'queued', at: Date.now() })
  chatText.value = ''
  chatText.style.height = ''
  setChatStatus('')
  sendOutboxes()
  showChat()
  chatLines.scrollTop = chatLines.scrollHeight
}

// Opens the chat card for a row's session, or closes it when that one is open.
function setChatSession(id) {
  if (chatId === id) id = null
  chatId = id
  chatStamp = 0
  chatData = null
  setChatStatus('')
  if (id && rows.has(id)) {
    chatText.value = ''
    chatWatchAt = 0
    showChat()
    chat.hidden = false
    chat.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 })
    updateChat()
  } else {
    chatId = null
    chat.hidden = true
  }
  for (const row of rows.values()) row.node.classList.toggle('is-chat', row.id === chatId)
  layout()
}

// Every tick while the panel is open: keep the watch alive, redraw on a new file.
async function updateChat() {
  const id = chatId
  if (!id) return
  const row = rows.get(id)
  if (!row) {
    setChatSession(id)
    return
  }
  $('chat-title').textContent = row.view ? row.view.title : ''
  const now = Date.now()
  if (now - chatWatchAt >= 2000) {
    hud.writeFile(`chat/${id}.watch`, String(now))
    chatWatchAt = now
  }
  const stamp = await hud.fileStamp(`chat/${id}.json`)
  if (!stamp || stamp === chatStamp || id !== chatId) return
  let data
  try {
    data = JSON.parse((await hud.readFile(`chat/${id}.json`)) || 'null')
  } catch {
    return
  }
  if (!data || id !== chatId) return
  chatData = data
  chatReadAt = now
  // A prompt the session refused: take it back out and say why.
  const box = outboxes.get(id)
  if (box && data.ack && data.ack.error) {
    const i = box.findIndex(x => x.id === data.ack.id)
    if (i >= 0) {
      box.splice(i, 1)
      setChatStatus(`보내지 못했어요: ${data.ack.error}`, 'Danger')
    }
  }
  showChat()
  chatStamp = stamp
}

function stepChatMini(frame) {
  if (!chatId || chat.hidden) return
  const row = rows.get(chatId)
  P.drawMiniState(chatMini.getContext('2d'), row ? row.state : 'idle', frame)
}
