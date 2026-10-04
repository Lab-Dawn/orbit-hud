import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Limit, Spend, Touch, TouchKind, Usage, Work } from '../types'

const PANE = 'hud-work'
const RECENT = 5

const usage = atom({ plugin: 'jarvis-hud', key: 'usage' } as const, null)
const work = atom({ plugin: 'jarvis-hud', key: 'work' } as const, {
  isActive: false,
  startedAt: 0,
  endedAt: 0,
  touches: [],
})
const spend = atom({ plugin: 'jarvis-hud', key: 'spend' } as const, null as Spend | null)

const WINDOW_SLACK_MS = 60_000

// Moves the window baseline when the five-hour window resets, so what each session
// shows is what it spent in the window now running.
async function trackSpend($: EngineInterface, u: Usage) {
  if (u.usd === undefined) return
  const usd = u.usd
  const resetsAt = u.limits.find(l => l.kind === 'five_hour')?.resetsAt ?? null
  await update($, spend, prev => {
    if (!prev || typeof prev.baseUsd !== 'number') {
      // First sight: a session that has spent nothing yet is counted in full.
      return { resetsAt, baseUsd: usd, isPartial: usd > 0, lastUsd: usd, turnBaseUsd: usd }
    }
    const isNewWindow =
      !!resetsAt && !!prev.resetsAt && Math.abs(Date.parse(resetsAt) - Date.parse(prev.resetsAt)) > WINDOW_SLACK_MS
    if (isNewWindow) {
      // The ledger last seen before the reset is where the new window starts.
      return { ...prev, resetsAt, baseUsd: prev.lastUsd, isPartial: false, lastUsd: usd }
    }
    return { ...prev, resetsAt: prev.resetsAt ?? resetsAt, lastUsd: usd }
  })
}

// The engine's context fill only moves on the next model response, so right after
// a compaction it still reads the old size. The compaction's own tokensAfter stands
// in until a measurement reports the context again.
let compactedTokens: number | null = null

function withCompacted(u: Usage): Usage {
  if (compactedTokens === null || !u.contextWindow) return u
  return {
    ...u,
    contextTokens: compactedTokens,
    contextPercent: (compactedTokens / u.contextWindow) * 100,
  }
}

async function refreshUsage($: EngineInterface) {
  const now = withCompacted(toUsage(await $.session.usage()))
  await update($, usage, () => now)
  await trackSpend($, now)
}

// Colours chosen to read on both light and dark backgrounds.
const ACCENT = '#0ea5c6'
const DANGER = '#e5484d'
const MUTED = '#7a8699'

const KIND_GLYPH: Record<TouchKind, string> = {
  read: '◇',
  edit: '✎',
  write: '✚',
  search: '⌕',
  run: '›',
  web: '◎',
}
const KIND_LABEL: Record<TouchKind, string> = {
  read: '읽기',
  edit: '수정',
  write: '생성',
  search: '검색',
  run: '실행',
  web: '웹',
}
const KIND_RANK: Record<TouchKind, number> = {
  read: 0,
  search: 0,
  run: 0,
  web: 0,
  edit: 1,
  write: 2,
}
const LIMIT_LABEL: Record<string, string> = {
  five_hour: '5시간',
  seven_day: '7일',
  spend_limit: '한도',
}
// The widget's pill is narrow, so it uses short tags.
const LIMIT_SHORT: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: '$',
}

type Hit = { key: string; kind: TouchKind; label: string; detail: string; isFile: boolean }

let cwd = ''
let liveFile = ''
// The widget reads `hide`, `show` or `toggle` from here (/hud on|off).
let widgetCommandFile = ''
let commandFile = ''
let answerFile = ''
let widgetScript = ''
let ticker: { cancel: () => void } | undefined
let publishing: { cancel: () => void } | undefined
let poller: { cancel: () => void } | undefined
// A compaction the widget asked for: waiting for the turn to end, sent in as a
// /compact prompt waiting its turn, or running.
let compactState: 'idle' | 'queued' | 'submitted' | 'running' = 'idle'
let compactWatch: { cancel: () => void } | undefined

// A question Claude is asking (AskUserQuestion), shown in the widget so it can be
// answered there as well as in the app's own dialog.
type QuestionOption = { label: string; description?: string }
type Question = {
  question: string
  header?: string
  kind?: string
  multiSelect?: boolean
  options?: QuestionOption[]
  placeholder?: string
  min?: number
  max?: number
  unit?: string
}
let pendingQuestion: { id: string; questions: Question[] } | null = null
// The last compaction that failed, with why, so the widget can say so.
let compactError: { message: string; at: number } | null = null

const slash = (p: string) => p.replace(/\\/g, '/')
const parent = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')))

function relative(path: string): string {
  const p = slash(path)
  const root = slash(cwd).replace(/\/$/, '')
  if (root && p.toLowerCase().startsWith(root.toLowerCase() + '/')) {
    return p.slice(root.length + 1)
  }
  return p
}

function fileHit(kind: TouchKind, path: string | undefined): Hit | null {
  if (!path) return null
  const rel = relative(path)
  const cut = rel.lastIndexOf('/')
  return {
    key: `file:${slash(path).toLowerCase()}`,
    kind,
    label: cut < 0 ? rel : rel.slice(cut + 1),
    detail: cut < 0 ? '' : rel.slice(0, cut),
    isFile: true,
  }
}

function textHit(kind: TouchKind, text: string | undefined, detail = ''): Hit | null {
  if (!text) return null
  const line = (text.split('\n')[0] ?? '').trim()
  return { key: `${kind}:${line}`, kind, label: line, detail, isFile: false }
}

function classify(tool: string, args: Record<string, unknown>): Hit | null {
  const s = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined)
  switch (tool) {
    case 'Read':
      return fileHit('read', s('file_path'))
    case 'Edit':
    case 'MultiEdit':
      return fileHit('edit', s('file_path'))
    case 'Write':
      return fileHit('write', s('file_path'))
    case 'NotebookEdit':
      return fileHit('edit', s('notebook_path'))
    case 'Glob':
    case 'Grep': {
      const where = s('path')
      return textHit('search', s('pattern'), where ? relative(where) : '')
    }
    case 'Bash':
    case 'PowerShell':
      return textHit('run', s('description') ?? s('command'), s('description') ? s('command') ?? '' : '')
    case 'WebFetch':
      return textHit('web', s('url'))
    case 'WebSearch':
      return textHit('web', s('query'))
    default:
      return null
  }
}

function begin(w: Work, hit: Hit): Work {
  const found = w.touches.find(t => t.key === hit.key)
  if (!found) {
    const touch: Touch = { ...hit, count: 1, running: 1, hasFailed: false }
    return { ...w, touches: [...w.touches, touch].slice(-60) }
  }
  const kind = KIND_RANK[hit.kind] > KIND_RANK[found.kind] ? hit.kind : found.kind
  const touch: Touch = { ...found, kind, count: found.count + 1, running: found.running + 1 }
  // Move the touched entry to the end so the newest activity sits at the bottom.
  return { ...w, touches: [...w.touches.filter(t => t.key !== hit.key), touch] }
}

function settle(w: Work, key: string, hasFailed: boolean): Work {
  return {
    ...w,
    touches: w.touches.map(t =>
      t.key === key
        ? { ...t, running: Math.max(0, t.running - 1), hasFailed: t.hasFailed || hasFailed }
        : t,
    ),
  }
}

function toUsage(u: {
  context: { percent?: number; tokens?: number; window: number }
  rateLimits: readonly Limit[]
  cost?: { usd: number }
}): Usage {
  return {
    contextPercent: u.context.percent,
    contextTokens: u.context.tokens,
    contextWindow: u.context.window,
    limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    usd: u.cost?.usd,
  }
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// A scanning segment that sweeps one step per redraw while Claude is busy.
function scanLine(now: number, width: number): [string, string, string] {
  const seg = 6
  const pos = Math.floor(now / 1000) % (width + seg) - seg
  const start = Math.max(0, pos)
  const end = Math.max(0, Math.min(width, pos + seg))
  return ['─'.repeat(start), '━'.repeat(end - start), '─'.repeat(width - end)]
}

// Everything the floating widget draws, written to one file per session.
async function publish($: EngineInterface, isEnded = false) {
  if (!liveFile) return
  const u = await read($, usage)
  const w = await read($, work)
  const s = await read($, spend)
  const current = [...w.touches].reverse().find(t => t.running > 0)
  const snapshot = {
    version: 1,
    project: slash(cwd).split('/').filter(Boolean).pop() ?? '',
    writtenAt: await $.clock.now(),
    isEnded,
    compact: compactState,
    compactError,
    question: pendingQuestion,
    spend:
      s && u?.usd !== undefined
        ? {
            resetsAt: s.resetsAt,
            windowUsd: Math.max(0, u.usd - s.baseUsd),
            isPartial: s.isPartial,
            turnUsd: Math.max(0, u.usd - s.turnBaseUsd),
            totalUsd: u.usd,
          }
        : null,
    usage: u
      ? [
          ...(u.contextPercent !== undefined
            ? [
                {
                  label: '컨텍스트',
                  short: 'ctx',
                  pct: Math.round(u.contextPercent),
                  resetsAt: null,
                  tokens: u.contextTokens ?? null,
                  window: u.contextWindow,
                },
              ]
            : []),
          ...u.limits.map(l => ({
            label: LIMIT_LABEL[l.kind] ?? l.kind,
            short: LIMIT_SHORT[l.kind] ?? l.kind,
            pct: Math.round(l.percentUsed),
            resetsAt: l.resetsAt ?? null,
          })),
        ]
      : [],
    work: {
      isActive: w.isActive,
      startedAt: w.startedAt,
      endedAt: w.endedAt,
      files: w.touches.filter(t => t.isFile).length,
      edited: w.touches.filter(t => t.kind === 'edit' || t.kind === 'write').length,
      actions: w.touches.reduce((n, t) => n + t.count, 0),
      current: current
        ? { glyph: KIND_GLYPH[current.kind], label: current.label, action: KIND_LABEL[current.kind] }
        : null,
      recent: w.touches
        .filter(t => t !== current)
        .slice(-RECENT)
        .map(t => ({ glyph: KIND_GLYPH[t.kind], label: t.label, count: t.count, hasFailed: t.hasFailed })),
    },
  }
  await $.fs.write(liveFile, JSON.stringify(snapshot))
}

// Coalesces bursts of updates (a run of tool calls) into one write.
function schedulePublish($: EngineInterface) {
  if (publishing) return
  publishing = $.clock.after(150, () => {
    publishing = undefined
    void publish($)
  })
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  if (typeof err === 'object' && err !== null) {
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}

async function failCompact($: EngineInterface, message: string) {
  compactWatch?.cancel()
  compactWatch = undefined
  compactState = 'idle'
  compactError = { message, at: await $.clock.now() }
  $.ui.toast(`컨텍스트를 압축하지 못했어요: ${message}`)
  if (liveFile) {
    const log = `${parent(parent(liveFile))}/compact-error.log`
    await $.fs.write(log, `${new Date().toISOString()} ${slash(cwd)}\n${message}\n`).catch(() => undefined)
  }
  await publish($)
}

// The engine's compaction call works in a terminal session. A desktop (SDK)
// session only compacts inside a turn, so there the widget's request runs the
// /compact command instead; the session.compact hook reports it starting and
// finishing.
async function runCompact($: EngineInterface) {
  compactError = null
  compactState = 'running'
  await publish($)
  try {
    await $.session.compact()
    compactState = 'idle'
    await publish($)
  } catch (err) {
    const message = describe(err)
    if (/headless|inside a turn|\/compact/i.test(message)) {
      await submitCompact($)
      return
    }
    await failCompact($, message)
  }
}

async function submitCompact($: EngineInterface) {
  compactState = 'submitted'
  await publish($)
  // If the command never turns into a compaction, say so rather than wait forever.
  compactWatch?.cancel()
  compactWatch = $.clock.after(120_000, () => {
    if (compactState === 'submitted') void failCompact($, '/compact 명령이 압축으로 이어지지 않았어요').catch(() => undefined)
  })
  try {
    await $.command.run({ command: 'compact' })
  } catch (err) {
    await failCompact($, describe(err))
    return
  }
  // The command has run; if the compaction hook never saw it start, settle here.
  if (compactState === 'submitted') {
    compactWatch?.cancel()
    compactWatch = undefined
    compactState = 'idle'
    await publish($)
    $.ui.toast('위젯 요청으로 /compact를 실행했어요.')
  }
}

// Compacts now, or once the running turn ends.
async function requestCompact($: EngineInterface) {
  if (compactState !== 'idle') return
  if ((await read($, work)).isActive) {
    compactState = 'queued'
    await publish($)
    return
  }
  await runCompact($)
}

// The widget asks for things by writing this session's command file; it is
// emptied before acting so a reload never replays a request.
async function checkCommands($: EngineInterface) {
  if (!commandFile || !(await $.fs.exists(commandFile))) return
  const text = String(await $.fs.read(commandFile)).trim()
  if (!text || text === '{}') return
  await $.fs.write(commandFile, '{}')
  let command: { action?: string }
  try {
    command = JSON.parse(text)
  } catch {
    return
  }
  if (command.action === 'compact') await requestCompact($)
}

// ---------- the widget's chat: recent conversation out, typed prompts in ----------

type ChatLine =
  | { role: 'user' | 'assistant'; text: string }
  | { role: 'tools'; tools: string[] }

const CHAT_LINES = 16
const CHAT_CLIP = 600

function clip(text: string, max = CHAT_CLIP): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// What the person typed, without the engine's wrappers: a slash command reads as
// itself, reminders and other tagged blocks drop out.
function userText(raw: string): string {
  const name = raw.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]
  if (name) {
    const args = raw.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim()
    return args ? `${name.trim()} ${args}` : name.trim()
  }
  return raw
    .replace(/<(system-reminder|local-command-[\w-]+)>[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function toChat(messages: readonly SessionMessage[]): ChatLine[] {
  const lines: ChatLine[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const text = userText(m.text)
      if (text) lines.push({ role: 'user', text: clip(text) })
      continue
    }
    const text = m.text.trim()
    if (text) lines.push({ role: 'assistant', text: clip(text) })
    if (m.toolUses.length > 0) {
      const last = lines[lines.length - 1]
      const names = m.toolUses.map(t => t.tool.replace(/^mcp__[^_]+__/, ''))
      if (last && last.role === 'tools') last.tools.push(...names)
      else lines.push({ role: 'tools', tools: names })
    }
  }
  return lines.slice(-CHAT_LINES)
}

// The widget rewrites the watch file every couple of seconds while this session's
// chat is open; the chat is written only then, and only when something moved.
let chatFile = ''
let watchFile = ''
let promptFile = ''
let chatDirty = true
let chatWrittenAt = 0
let watchMark = ''
let watchSeenAt = 0
let promptAck: { id: string; error?: string } | null = null

async function checkChat($: EngineInterface) {
  if (!watchFile || !(await $.fs.exists(watchFile))) return
  const mark = String(await $.fs.read(watchFile)).trim()
  const now = await $.clock.now()
  if (mark !== watchMark) {
    // A chat opened after a pause wants the conversation now.
    if (now - watchSeenAt > 6000) chatDirty = true
    watchMark = mark
    watchSeenAt = now
  }
  if (now - watchSeenAt > 6000) return
  const w = await read($, work)
  if (!chatDirty && !(w.isActive && now - chatWrittenAt > 2500)) return
  chatDirty = false
  chatWrittenAt = now
  const messages = await $.session.messages()
  await $.fs.write(
    chatFile,
    JSON.stringify({ writtenAt: now, isActive: w.isActive, ack: promptAck, lines: toChat(messages) }),
  )
}

// A prompt typed in the widget enters as the person's own words; a /command runs.
async function checkPrompt($: EngineInterface) {
  if (!promptFile || !(await $.fs.exists(promptFile))) return
  const text = String(await $.fs.read(promptFile)).trim()
  if (!text || text === '{}') return
  await $.fs.write(promptFile, '{}')
  let sent: { id?: string; text?: string }
  try {
    sent = JSON.parse(text)
  } catch {
    return
  }
  const body = (sent.text ?? '').trim()
  const id = sent.id ?? ''
  if (!body) return
  try {
    if (body.startsWith('/')) {
      const [name, ...rest] = body.slice(1).split(/\s+/)
      await $.command.run({ command: name, args: rest.join(' ') })
    } else {
      await $.prompt.submit({ text: body, asUser: true })
    }
    promptAck = { id }
  } catch (err) {
    promptAck = { id, error: describe(err) }
  }
  chatDirty = true
  await checkChat($)
}

// Keeps only what the widget draws of each question.
function toQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object' && typeof q.question === 'string')
    .map(q => ({
      question: q.question as string,
      header: typeof q.header === 'string' ? q.header : undefined,
      kind: typeof q.kind === 'string' ? q.kind : 'choice',
      multiSelect: q.multiSelect === true,
      options: Array.isArray(q.options)
        ? q.options
            .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && typeof o.label === 'string')
            .map(o => ({
              label: o.label as string,
              description: typeof o.description === 'string' ? o.description : undefined,
            }))
        : [],
      placeholder: typeof q.placeholder === 'string' ? q.placeholder : undefined,
      min: typeof q.min === 'number' ? q.min : undefined,
      max: typeof q.max === 'number' ? q.max : undefined,
      unit: typeof q.unit === 'string' ? q.unit : undefined,
    }))
}

// Waits for the widget to answer question `id`, until `isDone` says the app answered first.
async function waitForAnswer(
  $: EngineInterface,
  id: string,
  isDone: () => boolean,
  signal: AbortSignal,
): Promise<Record<string, string> | null> {
  while (!isDone() && !signal.aborted) {
    if (answerFile && (await $.fs.exists(answerFile))) {
      const text = String(await $.fs.read(answerFile)).trim()
      if (text && text !== '{}') {
        let reply: { questionId?: string; answers?: Record<string, string> } = {}
        try {
          reply = JSON.parse(text)
        } catch {
          reply = {}
        }
        if (reply.questionId === id && reply.answers) {
          await $.fs.write(answerFile, '{}')
          return reply.answers
        }
      }
    }
    try {
      await $.clock.sleep(400, { signal })
    } catch {
      return null
    }
  }
  return null
}

// Starts the widget; it keeps itself to one instance, so a second launch exits at once.
async function launchWidget($: EngineInterface) {
  if (!widgetScript) return
  const args = `'-NoProfile','-STA','-ExecutionPolicy','Bypass','-File','"${widgetScript}"'`
  await $.process.run(
    ['powershell.exe', '-NoProfile', '-Command', `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList ${args}`],
    { timeoutMs: 15_000 },
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    // Live files sit outside the plugin folder so writing them never triggers a reload.
    const root = slash($.plugin.root)
    const live = `${parent(parent(root))}/jarvis-hud-live`
    const id = await $.session.id()
    liveFile = `${live}/sessions/${id}.json`
    commandFile = `${live}/commands/${id}.json`
    answerFile = `${live}/answers/${id}.json`
    widgetCommandFile = `${live}/widget-command`
    chatFile = `${live}/chat/${id}.json`
    watchFile = `${live}/chat/${id}.watch`
    promptFile = `${live}/prompts/${id}.json`
    widgetScript = `${root}/widget/widget.ps1`
    poller?.cancel()
    let ticks = 0
    poller = $.clock.every(1000, () => {
      void checkCommands($).catch(() => undefined)
      void checkPrompt($).catch(() => undefined)
      void checkChat($).catch(() => undefined)
      ticks += 1
      // The cost ledger moves mid-turn too; read it every few seconds while working.
      if (ticks % 5 === 0) {
        void read($, work)
          .then(w => (w.isActive ? refreshUsage($).then(() => schedulePublish($)) : undefined))
          .catch(() => undefined)
      }
      // A heartbeat, so the widget can tell an idle session from one that is gone.
      if (ticks % 30 === 0) void publish($).catch(() => undefined)
    })
    await $.command.register({
      name: 'hud',
      description: '자비스 위젯 켜고 끄기 (/hud on, /hud off · 단축키 Ctrl+Alt+J), 인자 없으면 작업 현황 패널',
    })
    await refreshUsage($)
    await publish($)
    void launchWidget($).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await publish($, true)
    return next(e)
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'on' || arg === 'widget') {
      // Starts it if it is not running (it keeps to one instance), and brings it back if hidden.
      await $.fs.write(widgetCommandFile, 'show')
      await launchWidget($)
      return { text: '자비스 위젯을 켰어요. (Ctrl+Alt+J로 숨기기)' }
    }
    if (arg === 'off') {
      await $.fs.write(widgetCommandFile, 'hide')
      return { text: '자비스 위젯을 숨겼어요. /hud on 이나 Ctrl+Alt+J로 다시 켤 수 있어요.' }
    }
    await $.ui.open({ id: PANE, title: '작업 현황' })
    return { text: '작업 현황 패널을 열었어요.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) compactedTokens = null
    const now = withCompacted(toUsage(e))
    await update($, usage, () => now)
    await trackSpend($, now)
    schedulePublish($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // A subagent's turn is part of the main one; only the main turn starts over.
    if ((e as { agentId?: string }).agentId) return next(e)
    chatDirty = true
    const now = await $.clock.now()
    await update($, work, () => ({ isActive: true, startedAt: now, endedAt: 0, touches: [] }))
    const atStart = await read($, usage)
    if (atStart?.usd !== undefined) {
      const usd = atStart.usd
      await update($, spend, prev => (prev ? { ...prev, turnBaseUsd: usd } : prev))
    }
    ticker?.cancel()
    ticker = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
    await publish($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    chatDirty = true
    ticker?.cancel()
    ticker = undefined
    const now = await $.clock.now()
    await update($, work, prev => ({
      ...prev,
      isActive: false,
      endedAt: now,
      touches: prev.touches.map(t => ({ ...t, running: 0 })),
    }))
    await publish($)
    if (compactState === 'queued') {
      compactState = 'idle'
      // Let the turn finish closing before the compaction starts.
      $.clock.after(500, () => void requestCompact($).catch(() => undefined))
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const hit = classify(e.tool, e as unknown as Record<string, unknown>)
    if (!hit) return next(e)
    await update($, work, w => begin(w, hit))
    schedulePublish($)
    const ran = await next(e)
    const hasFailed = ran.deny !== undefined || ran.isError === true
    await update($, work, w => settle(w, hit.key, hasFailed))
    schedulePublish($)
    return ran
  })

  // Every compaction of the main conversation reports here, the widget's or the
  // person's own /compact, so the context gauge drops as soon as it is done.
  on('session.compact', async ($, e, next) => {
    if (e.agentId || e.trigger === 'precompute') return next(e)
    const isOurs = compactState === 'submitted' || compactState === 'running'
    if (isOurs) {
      compactWatch?.cancel()
      compactWatch = undefined
      compactState = 'running'
      await publish($)
    }
    try {
      const result = await next(e)
      if (result.messages && typeof result.tokensAfter === 'number') {
        compactedTokens = result.tokensAfter
      }
      return result
    } finally {
      if (isOurs) {
        compactState = 'idle'
        $.ui.toast('위젯 요청으로 컨텍스트를 압축했어요.')
      }
      await refreshUsage($).catch(() => undefined)
      await publish($)
      chatDirty = true
    }
  })

  // Claude's questions: the app's dialog and the widget race, and the first answer wins.
  // When the widget answers, this hook settles the call and the dialog beneath is dropped.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const raw = (e as unknown as { questions?: unknown }).questions
    const questions = toQuestions(raw)
    if (questions.length === 0) return next(e)

    pendingQuestion = { id: e.tool_use_id, questions }
    await publish($)
    let isAppDone = false
    const fromApp = next(e).then(r => {
      isAppDone = true
      return { via: 'app' as const, r }
    })
    fromApp.catch(() => undefined)
    const fromWidget = waitForAnswer($, e.tool_use_id, () => isAppDone, next.signal).then(answers => ({
      via: 'widget' as const,
      answers,
    }))
    try {
      const first = await Promise.race([fromApp, fromWidget])
      if (first.via === 'widget' && first.answers) {
        $.ui.toast('위젯에서 질문에 답했어요.')
        return { result: { questions: raw, answers: first.answers } } as never
      }
      return (await fromApp).r
    } finally {
      pendingQuestion = null
      await publish($)
    }
  })

  // The detailed work pane, opened on demand with /hud.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const w = await read($, work)
    const now = await $.clock.now()
    const elapsed = clock((w.isActive ? now : w.endedAt || now) - w.startedAt)
    const files = w.touches.filter(t => t.isFile).length
    const current = [...w.touches].reverse().find(t => t.running > 0)
    const room = Math.max(3, (e.viewport?.rows ?? 24) - 7)
    const shown = w.touches.slice(-room)

    let scan = null
    if (w.isActive) {
      const [before, lit, after] = scanLine(now, Math.max(10, Math.min(40, e.props.bodyColumns - 2)))
      scan = (
        <Text>
          <Text color={MUTED} dimColor>
            {before}
          </Text>
          <Text color={ACCENT}>{lit}</Text>
          <Text color={MUTED} dimColor>
            {after}
          </Text>
        </Text>
      )
    }

    return (
      <Box flexDirection="column" gap={0}>
        <Box justifyContent="space-between">
          <Text>
            {w.isActive ? (
              <Text color={ACCENT} bold>
                ● 작업 중
              </Text>
            ) : (
              <Text color="green" bold>
                ✓ 완료
              </Text>
            )}
            <Text dimColor>
              {'  '}
              {elapsed} · 파일 {files}개 · 동작 {w.touches.reduce((n, t) => n + t.count, 0)}회
            </Text>
          </Text>
          <Button key="close" label="닫기" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {scan}
        <Text>
          {current ? (
            <Text>
              <Text color={ACCENT}>▶ </Text>
              <Text bold>{current.label}</Text>
              <Text dimColor> {KIND_LABEL[current.kind]} 중…</Text>
            </Text>
          ) : (
            <Text dimColor>{w.isActive ? '생각하는 중…' : '대기 중'}</Text>
          )}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {shown.length === 0 && <Text dimColor>아직 손댄 파일이 없어요.</Text>}
          {shown.map(t => (
            <Box key={t.key} gap={1}>
              <Text color={t.running > 0 ? ACCENT : t.hasFailed ? DANGER : undefined} dimColor={t.running === 0 && !t.hasFailed}>
                {KIND_GLYPH[t.kind]} {KIND_LABEL[t.kind]}
              </Text>
              <Text bold={t.running > 0} wrap="truncate-end">
                {t.label}
              </Text>
              {t.detail ? (
                <Text dimColor wrap="truncate-start">
                  {t.detail}
                </Text>
              ) : null}
              {t.count > 1 ? <Text dimColor>×{t.count}</Text> : null}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
