// Captures the README pictures from a second widget running on made-up sessions
// (nothing real is shown), into docs/raw/<lang> (the ring, which has no words, into
// docs/raw); then run make_docs.py. Each README language gets its own pictures.
//   node docs/tools/capture.js                     all pictures, in every language
//   node docs/tools/capture.js --lang ko           one language
//   node docs/tools/capture.js <step...>           only some: question coreframes ring panel-chat panel glance notice
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const repo = path.resolve(__dirname, '..', '..')
const demo = path.join(os.homedir(), '.claude', 'orbit-hud-demo')
const rawDir = path.join(repo, 'docs', 'raw')
let out = rawDir
const app = path.join(repo, 'app')
// The Electron the launcher installed, or one under app/node_modules when working on the widget.
const electron = [path.join(app, 'node_modules', 'electron'), path.join(os.homedir(), '.claude', 'orbit-hud-live', 'runtime', 'node_modules', 'electron')]
  .map(dir => {
    try {
      return require(dir)
    } catch {
      return null
    }
  })
  .find(Boolean)
const args = process.argv.slice(2)
const langAt = args.indexOf('--lang')
const langs = langAt >= 0 ? [args[langAt + 1]] : ['en', 'ko', 'ja']
const steps = langAt >= 0 ? args.filter((a, i) => i !== langAt && i !== langAt + 1) : args
const wants = step => steps.length === 0 || steps.includes(step)

// The made-up sessions and conversation, in each README language.
const DEMO = {
  en: {
    projects: ['Payment module refactor', 'Blog dark mode', 'API docs cleanup', 'Raise test coverage'],
    question: {
      question: 'How should dark mode work?', header: 'Approach',
      options: [['CSS variables', 'Switch with theme tokens'], ['Tailwind dark:', 'Set per class'], ['Mix both']],
    },
    chat: [
      'Make payments retry when they fail',
      "I'll wrap the payment request and retry up to 3 times, waiting a little longer each time.",
      'Added the retry logic. Running the tests now.',
    ],
    say: "Write the PR description when you're done",
    notice: 'Finished · 3:12 · 4 files edited',
  },
  ko: {
    projects: ['결제 모듈 리팩터링', '블로그 다크 모드', 'API 문서 정리', '테스트 커버리지 올리기'],
    question: {
      question: '다크 모드는 어떻게 할까요?', header: '구현 방식',
      options: [['CSS 변수', '테마 토큰으로 전환'], ['Tailwind dark:', '클래스마다 지정'], ['둘 다 섞어서']],
    },
    chat: [
      '결제 실패하면 재시도하게 해줘',
      '결제 요청을 감싸서 최대 3번, 간격을 늘려 가며 다시 시도하게 할게요.',
      '재시도 로직을 넣었어요. 이제 테스트를 돌려 볼게요.',
    ],
    say: '끝나면 PR 설명도 써줘',
    notice: '끝났어요 · 3:12 · 파일 4개 수정',
  },
  ja: {
    projects: ['決済モジュールのリファクタリング', 'ブログのダークモード', 'APIドキュメント整理', 'テストカバレッジ向上'],
    question: {
      question: 'ダークモードはどう実装しますか？', header: '実装方法',
      options: [['CSS変数', 'テーマトークンで切り替え'], ['Tailwind dark:', 'クラスごとに指定'], ['両方を組み合わせる']],
    },
    chat: [
      '決済が失敗したらリトライするようにして',
      '決済リクエストをラップして、間隔を広げながら最大3回まで再試行するようにします。',
      'リトライ処理を追加しました。テストを実行してみます。',
    ],
    say: '終わったらPRの説明も書いて',
    notice: '完了しました · 3:12 · ファイル 4件を編集',
  },
}
let D = DEMO.en

const wait = ms => new Promise(r => setTimeout(r, ms))
const RING_LEVELS = [20, 45, 70, 92]
const reset5h = new Date(Date.now() + 162 * 60000).toISOString()
const reset7d = new Date(Date.now() + 3 * 86400000 + 5 * 3600000).toISOString()

// A made-up transcript of two responses, the last `ago` minutes back, for the cache line.
function writeTranscript(id, ttl, ago, hit) {
  const at = Date.now() - ago * 60000
  const line = (type, ms, usage) => JSON.stringify({
    type, timestamp: new Date(ms).toISOString(), isSidechain: false,
    ...(usage ? { message: { id: `msg-${ms}`, model: 'claude-opus-5-5', usage } } : {}),
  })
  const usage = (read, written) => ({
    input_tokens: 40, output_tokens: 900, cache_read_input_tokens: read, cache_creation_input_tokens: written,
    cache_creation: { ephemeral_5m_input_tokens: ttl === '5m' ? written : 0, ephemeral_1h_input_tokens: ttl === '1h' ? written : 0 },
  })
  const file = path.join(demo, 'transcripts', `${id}.jsonl`)
  fs.writeFileSync(file, [
    line('user', at - 90000), line('assistant', at - 80000, usage(0, 30000)),
    line('user', at - 2000), line('assistant', at, usage(Math.round(hit * 400000), Math.round((1 - hit) * 400000))),
  ].join('\n') + '\n')
  return file
}

function writeSession(id, project, ctx, usd, isActive, current, question, startedAgo, cache) {
  const now = Date.now()
  const s = {
    version: 1, project, writtenAt: now, limitsAt: now, isEnded: false, compact: 'idle', compactError: null, question,
    transcript: writeTranscript(id, ...cache),
    spend: { resetsAt: reset5h, windowUsd: usd, isPartial: false, turnUsd: 0, totalUsd: usd },
    usage: [
      { label: '컨텍스트', short: 'ctx', pct: ctx, resetsAt: null, tokens: ctx * 10000, window: 1000000 },
      { label: '5시간', short: '5h', pct: 38, resetsAt: reset5h },
      { label: '7일', short: '7d', pct: 54, resetsAt: reset7d },
    ],
    work: { isActive, startedAt: now - startedAgo * 1000, endedAt: isActive ? 0 : now - 600000, files: 3, edited: 2, actions: 14, current, recent: [] },
  }
  fs.writeFileSync(path.join(demo, 'sessions', `${id}.json`), JSON.stringify(s, null, 2))
}

const question = () => ({
  id: 'demo-q',
  questions: [{
    question: D.question.question, header: D.question.header, multiSelect: false,
    options: D.question.options.map(([label, description]) => (description ? { label, description } : { label })),
  }],
})

function writeAll(isAsking) {
  writeSession('a1000000-0000-0000-0000-000000000001', D.projects[0], 46, 6.2, true, { glyph: '✎', label: 'payment.ts', action: '수정', kind: 'edit' }, null, 194, ['1h', 0.1, 0.96])
  writeSession('a1000000-0000-0000-0000-000000000002', D.projects[1], 23, 2.1, false, null, isAsking ? question() : null, 0, ['1h', 22, 0.91])
  writeSession('a1000000-0000-0000-0000-000000000003', D.projects[2], 72, 3.4, false, null, null, 0, ['5m', 9, 0.88])
  writeSession('a1000000-0000-0000-0000-000000000004', D.projects[3], 18, 0.9, false, null, null, 0, ['1h', 52, 0.93])
}

async function request(word) {
  const file = path.join(demo, 'snap-request')
  fs.writeFileSync(file, word)
  for (let i = 0; i < 80 && fs.existsSync(file); i++) await wait(100)
  const shot = path.join(demo, 'snap.png')
  const before = fs.existsSync(shot) ? fs.statSync(shot).mtimeMs : 0
  for (let i = 0; i < 80; i++) {
    if (fs.existsSync(shot) && fs.statSync(shot).mtimeMs !== before) break
    await wait(100)
  }
  await wait(150)
}

async function snap(name, word = '') {
  await request(word)
  fs.copyFileSync(path.join(demo, 'snap.png'), path.join(out, `${name}.png`))
  console.log('saved', name)
}

async function main() {
  for (const lang of langs) {
    if (!DEMO[lang]) throw new Error(`no demo for ${lang}`)
    D = DEMO[lang]
    out = path.join(rawDir, lang)
    console.log(`-- ${lang}`)
    await capture(lang)
  }
}

async function capture(lang) {
  fs.rmSync(demo, { recursive: true, force: true })
  for (const d of ['sessions', 'chat', 'prompts', 'answers', 'commands', 'transcripts']) fs.mkdirSync(path.join(demo, d), { recursive: true })
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(demo, 'widget.json'), JSON.stringify({ left: 1460, top: 780, scale: 2, hidden: false, lang }))
  fs.writeFileSync(path.join(demo, 'chat', 'a1000000-0000-0000-0000-000000000001.json'), JSON.stringify({
    writtenAt: 0, isActive: true, ack: null, lines: [
      { role: 'user', text: D.chat[0] },
      { role: 'assistant', text: D.chat[1] },
      { role: 'tools', tools: ['Read', 'Read', 'Grep', 'Edit'] },
      { role: 'assistant', text: D.chat[2] },
      { role: 'tools', tools: ['Bash'] },
    ],
  }))
  writeAll(true)
  const child = spawn(electron, [app], { env: { ...process.env, ORBIT_HUD_LIVE: demo, ORBIT_HUD_PROJECTS: path.join(demo, 'projects'), ORBIT_HUD_CAPTURE: '1' }, stdio: 'ignore' })
  try {
    await wait(4000)
    if (wants('question')) await snap('question')
    if (wants('coreframes')) {
      for (const mode of ['idle', 'working', 'ask']) await request(`coreframes:${mode}|38`)
      for (const mode of ['idle', 'working', 'ask']) {
        for (let k = 0; k < 12; k++) fs.renameSync(path.join(demo, `core-${mode}-${k}.png`), path.join(out, `core-${mode}-${k}.png`))
      }
    }
    // The ring at a few levels of 5h usage: blue, then yellow from 60%, red from 85%.
    if (wants('ring') && lang === langs[0]) {
      for (const pct of RING_LEVELS) {
        await request(`coreframes:idle|${pct}`)
        fs.renameSync(path.join(demo, 'core-idle-0.png'), path.join(rawDir, `ring-${pct}.png`))
        for (let k = 1; k < 12; k++) fs.rmSync(path.join(demo, `core-idle-${k}.png`), { force: true })
      }
    }
    writeAll(false)
    await wait(800)
    if (wants('panel-chat')) {
      await request('chat:a1000000-0000-0000-0000-000000000001')
      await wait(800)
      await request(`say:${D.say}`)
      await wait(600)
      await snap('panel-chat')
      await request('chat:a1000000-0000-0000-0000-000000000001')
      await wait(600)
    }
    if (wants('panel')) await snap('panel', 'panel')
    if (wants('glance')) {
      writeAll(false)
      await wait(600)
      await snap('glance', 'hover')
      await request('unhover')
      await wait(400)
    }
    if (wants('notice')) {
      await request('panel-close')
      writeAll(false)
      await request(`notice:Done|✓ ${D.projects[2]}|${D.notice}`)
      await wait(900)
      await snap('notice')
    }
  } finally {
    // The next language starts from a clean folder, so wait until this widget is gone.
    const gone = new Promise(r => child.once('exit', r))
    child.kill()
    await Promise.race([gone, wait(5000)])
  }
  const log = path.join(demo, 'widget-error.log')
  if (fs.existsSync(log)) console.log(fs.readFileSync(log, 'utf8'))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
