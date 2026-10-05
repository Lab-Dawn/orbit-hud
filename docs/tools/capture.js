// Captures the README pictures from a second widget running on made-up sessions
// (nothing real is shown), into docs/raw; then run make_docs.py.
//   node docs/tools/capture.js            all pictures
//   node docs/tools/capture.js <step...>  only some: question coreframes panel-chat panel notice
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const repo = path.resolve(__dirname, '..', '..')
const demo = path.join(os.homedir(), '.claude', 'orbit-hud-demo')
const out = path.join(repo, 'docs', 'raw')
const app = path.join(repo, 'app')
const electron = require(path.join(app, 'node_modules', 'electron'))
const steps = process.argv.slice(2)
const wants = step => steps.length === 0 || steps.includes(step)

const wait = ms => new Promise(r => setTimeout(r, ms))
const reset5h = new Date(Date.now() + 162 * 60000).toISOString()
const reset7d = new Date(Date.now() + 3 * 86400000 + 5 * 3600000).toISOString()

function writeSession(id, project, ctx, usd, isActive, current, question, startedAgo) {
  const now = Date.now()
  const s = {
    version: 1, project, writtenAt: now, limitsAt: now, isEnded: false, compact: 'idle', compactError: null, question,
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

const question = {
  id: 'demo-q',
  questions: [{
    question: '다크 모드는 어떻게 할까요?', header: '구현 방식', multiSelect: false,
    options: [
      { label: 'CSS 변수', description: '테마 토큰으로 전환' },
      { label: 'Tailwind dark:', description: '클래스마다 지정' },
      { label: '둘 다 섞어서' },
    ],
  }],
}

function writeAll(isAsking) {
  writeSession('a1000000-0000-0000-0000-000000000001', '결제 모듈 리팩터링', 46, 6.2, true, { glyph: '✎', label: 'payment.ts', action: '수정' }, null, 194)
  writeSession('a1000000-0000-0000-0000-000000000002', '블로그 다크 모드', 23, 2.1, false, null, isAsking ? question : null, 0)
  writeSession('a1000000-0000-0000-0000-000000000003', 'API 문서 정리', 72, 3.4, false, null, null, 0)
  writeSession('a1000000-0000-0000-0000-000000000004', '테스트 커버리지 올리기', 18, 0.9, false, null, null, 0)
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
  fs.rmSync(demo, { recursive: true, force: true })
  for (const d of ['sessions', 'chat', 'prompts', 'answers', 'commands']) fs.mkdirSync(path.join(demo, d), { recursive: true })
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(demo, 'widget.json'), JSON.stringify({ left: 1460, top: 780, scale: 2, hidden: false }))
  fs.writeFileSync(path.join(demo, 'chat', 'a1000000-0000-0000-0000-000000000001.json'), JSON.stringify({
    writtenAt: 0, isActive: true, ack: null, lines: [
      { role: 'user', text: '결제 실패하면 재시도하게 해줘' },
      { role: 'assistant', text: '결제 요청을 감싸서 최대 3번, 간격을 늘려 가며 다시 시도하게 할게요.' },
      { role: 'tools', tools: ['Read', 'Read', 'Grep', 'Edit'] },
      { role: 'assistant', text: '재시도 로직을 넣었어요. 이제 테스트를 돌려 볼게요.' },
      { role: 'tools', tools: ['Bash'] },
    ],
  }))
  writeAll(true)
  const child = spawn(electron, [app], { env: { ...process.env, ORBIT_HUD_LIVE: demo, ORBIT_HUD_CAPTURE: '1' }, stdio: 'ignore' })
  try {
    await wait(4000)
    if (wants('question')) await snap('question')
    if (wants('coreframes')) {
      for (const mode of ['idle', 'working', 'ask']) await request(`coreframes:${mode}|38`)
      for (const mode of ['idle', 'working', 'ask']) {
        for (let k = 0; k < 12; k++) fs.renameSync(path.join(demo, `core-${mode}-${k}.png`), path.join(out, `core-${mode}-${k}.png`))
      }
    }
    writeAll(false)
    await wait(800)
    if (wants('panel-chat')) {
      await request('chat:a1000000-0000-0000-0000-000000000001')
      await wait(800)
      await request('say:끝나면 PR 설명도 써줘')
      await wait(600)
      await snap('panel-chat')
      await request('chat:a1000000-0000-0000-0000-000000000001')
      await wait(600)
    }
    if (wants('panel')) await snap('panel', 'panel')
    if (wants('notice')) {
      await request('panel-close')
      writeAll(false)
      await request('notice:Done|✓ API 문서 정리|끝났어요 · 3:12 · 파일 4개 수정')
      await wait(900)
      await snap('notice')
    }
  } finally {
    child.kill()
  }
  const log = path.join(demo, 'widget-error.log')
  if (fs.existsSync(log)) console.log(fs.readFileSync(log, 'utf8'))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
