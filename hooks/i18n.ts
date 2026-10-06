// The plugin's user-visible strings in English, Korean and Japanese. English is the
// default and the fallback for a key another language lacks. This file holds no `$`
// (the engine follows `$` only within one file); register.tsx settles the language
// and hands it here with setLang.

export type Lang = 'en' | 'ko' | 'ja'

const en = {
  'kind.read': 'Read',
  'kind.edit': 'Edit',
  'kind.write': 'Create',
  'kind.search': 'Search',
  'kind.run': 'Run',
  'kind.web': 'Web',

  'limit.context': 'Context',
  'limit.five_hour': '5 hours',
  'limit.seven_day': '7 days',
  'limit.spend_limit': 'Limit',

  'compact.failed': "Couldn't compact the context: {message}",
  'compact.notStarted': "/compact didn't lead to a compaction",
  'compact.commandRan': 'Ran /compact as the widget asked.',
  'compact.done': 'Compacted the context as the widget asked.',

  'question.answeredInWidget': 'Answered the question in the widget.',

  'widget.firstSetup': 'Setting up the Orbit widget for the first time. Downloading Electron may take about a minute.',
  'widget.noNode': "Couldn't start the Orbit widget. Check that Node.js is installed.",
  'widget.launchFailed': "Couldn't start the Orbit widget: {error}",

  'hud.description': 'Show or hide the Orbit widget (/hud on, /hud off · Ctrl+Alt+O), change its language (/hud lang); no argument opens the work panel',
  'hud.langSet': 'Orbit language: {name}.',
  'hud.langNow': 'Orbit language: {name}. Change it with /hud lang auto | en | ko | ja (auto follows the system).',
  'hud.langAuto': 'Auto ({name})',
  'hud.shown': 'Orbit widget on. (Ctrl+Alt+O hides it)',
  'hud.hidden': 'Orbit widget hidden. Bring it back with /hud on or Ctrl+Alt+O.',
  'hud.paneOpened': 'Opened the work panel.',

  'pane.title': 'Work status',
  'pane.working': '● Working',
  'pane.done': '✓ Done',
  'pane.stats': '{elapsed} · {files} files · {actions} actions',
  'pane.close': 'Close',
  'pane.doing': '{action}…',
  'pane.thinking': 'Thinking…',
  'pane.idle': 'Idle',
  'pane.empty': 'No files touched yet.',
}

export type Key = keyof typeof en

const ko: Record<Key, string> = {
  'kind.read': '읽기',
  'kind.edit': '수정',
  'kind.write': '생성',
  'kind.search': '검색',
  'kind.run': '실행',
  'kind.web': '웹',

  'limit.context': '컨텍스트',
  'limit.five_hour': '5시간',
  'limit.seven_day': '7일',
  'limit.spend_limit': '한도',

  'compact.failed': '컨텍스트를 압축하지 못했어요: {message}',
  'compact.notStarted': '/compact 명령이 압축으로 이어지지 않았어요',
  'compact.commandRan': '위젯 요청으로 /compact를 실행했어요.',
  'compact.done': '위젯 요청으로 컨텍스트를 압축했어요.',

  'question.answeredInWidget': '위젯에서 질문에 답했어요.',

  'widget.firstSetup': 'Orbit 위젯을 처음 준비하고 있어요. Electron을 내려받느라 1분쯤 걸릴 수 있어요.',
  'widget.noNode': 'Orbit 위젯을 띄우지 못했어요. Node.js가 설치되어 있는지 확인해 주세요.',
  'widget.launchFailed': 'Orbit 위젯을 띄우지 못했어요: {error}',

  'hud.description': 'Orbit 위젯 켜고 끄기 (/hud on, /hud off · 단축키 Ctrl+Alt+O), 언어 바꾸기 (/hud lang), 인자 없으면 작업 현황 패널',
  'hud.langSet': 'Orbit 언어: {name}',
  'hud.langNow': 'Orbit 언어: {name}. /hud lang auto | en | ko | ja 로 바꿀 수 있어요 (auto는 시스템 언어를 따라요).',
  'hud.langAuto': '자동 ({name})',
  'hud.shown': 'Orbit 위젯을 켰어요. (Ctrl+Alt+O로 숨기기)',
  'hud.hidden': 'Orbit 위젯을 숨겼어요. /hud on 이나 Ctrl+Alt+O로 다시 켤 수 있어요.',
  'hud.paneOpened': '작업 현황 패널을 열었어요.',

  'pane.title': '작업 현황',
  'pane.working': '● 작업 중',
  'pane.done': '✓ 완료',
  'pane.stats': '{elapsed} · 파일 {files}개 · 동작 {actions}회',
  'pane.close': '닫기',
  'pane.doing': '{action} 중…',
  'pane.thinking': '생각하는 중…',
  'pane.idle': '대기 중',
  'pane.empty': '아직 손댄 파일이 없어요.',
}

const ja: Record<Key, string> = {
  'kind.read': '読み取り',
  'kind.edit': '編集',
  'kind.write': '作成',
  'kind.search': '検索',
  'kind.run': '実行',
  'kind.web': 'Web',

  'limit.context': 'コンテキスト',
  'limit.five_hour': '5時間',
  'limit.seven_day': '7日',
  'limit.spend_limit': '上限',

  'compact.failed': 'コンテキストを圧縮できませんでした: {message}',
  'compact.notStarted': '/compact が圧縮につながりませんでした',
  'compact.commandRan': 'ウィジェットの依頼で /compact を実行しました。',
  'compact.done': 'ウィジェットの依頼でコンテキストを圧縮しました。',

  'question.answeredInWidget': 'ウィジェットで質問に回答しました。',

  'widget.firstSetup': 'Orbit ウィジェットを初めて準備しています。Electron のダウンロードに1分ほどかかることがあります。',
  'widget.noNode': 'Orbit ウィジェットを起動できませんでした。Node.js がインストールされているか確認してください。',
  'widget.launchFailed': 'Orbit ウィジェットを起動できませんでした: {error}',

  'hud.description': 'Orbit ウィジェットの表示切替 (/hud on, /hud off · Ctrl+Alt+O)、言語の変更 (/hud lang)、引数なしで作業状況パネル',
  'hud.langSet': 'Orbit の言語: {name}',
  'hud.langNow': 'Orbit の言語: {name}。/hud lang auto | en | ko | ja で変更できます (auto はシステムの言語に従います)。',
  'hud.langAuto': '自動 ({name})',
  'hud.shown': 'Orbit ウィジェットを表示しました。(Ctrl+Alt+O で非表示)',
  'hud.hidden': 'Orbit ウィジェットを非表示にしました。/hud on または Ctrl+Alt+O で再表示できます。',
  'hud.paneOpened': '作業状況パネルを開きました。',

  'pane.title': '作業状況',
  'pane.working': '● 作業中',
  'pane.done': '✓ 完了',
  'pane.stats': '{elapsed} · ファイル {files}件 · 操作 {actions}回',
  'pane.close': '閉じる',
  'pane.doing': '{action}中…',
  'pane.thinking': '考え中…',
  'pane.idle': '待機中',
  'pane.empty': 'まだ触れたファイルはありません。',
}

const DICTS: Record<Lang, Record<Key, string>> = { en, ko, ja }

let lang: Lang = 'en'

export function currentLang(): Lang {
  return lang
}

/** Switches the language; answers whether it changed. */
export function setLang(next: Lang): boolean {
  if (next === lang) return false
  lang = next
  return true
}

/** The string for `key` in the current language, `{name}` placeholders filled from `vars`. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const text = DICTS[lang][key] ?? en[key] ?? key
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all))
}

/** A locale tag or POSIX locale (`ko-KR`, `ja_JP.UTF-8`) as a language; null when empty. */
export function langFromTag(tag: string | undefined | null): Lang | null {
  const s = (tag ?? '').trim().toLowerCase()
  if (!s) return null
  if (s.startsWith('ko')) return 'ko'
  if (s.startsWith('ja')) return 'ja'
  return 'en'
}

/** The language widget.json names (the menu's choice, else the one the widget resolved), or null. */
export function langFromPref(text: string): Lang | null {
  try {
    // `lang` is the menu's choice; on "auto" the widget also writes the language it
    // settled on from the system (`langResolved`), so the two always agree.
    const pref = JSON.parse(text) as { lang?: unknown; langResolved?: unknown }
    const pick = (v: unknown): Lang | null => (v === 'en' || v === 'ko' || v === 'ja' ? v : null)
    return pick(pref.lang) ?? pick(pref.langResolved)
  } catch {
    return null
  }
}

/** The runtime's own locale, when it has Intl. */
export function intlLocale(): string | null {
  try {
    const intl = (globalThis as { Intl?: typeof Intl }).Intl
    return intl ? intl.DateTimeFormat().resolvedOptions().locale : null
  } catch {
    return null
  }
}
