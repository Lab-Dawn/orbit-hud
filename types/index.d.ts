export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Usage = {
  contextPercent?: number
  contextTokens?: number
  contextWindow: number
  limits: Limit[]
  usd?: number
}

export type TouchKind = 'read' | 'edit' | 'write' | 'search' | 'run' | 'web'

export type Touch = {
  key: string
  kind: TouchKind
  label: string
  detail: string
  count: number
  running: number
  hasFailed: boolean
  isFile: boolean
}

export type Work = {
  isActive: boolean
  startedAt: number
  endedAt: number
  touches: Touch[]
}

// What this session has spent inside the current five-hour rate-limit window,
// measured on the engine's cost ledger (priced per model, cache reads and writes
// at their own rates). `baseUsd` is the ledger when the window began, or when the
// plugin first saw it (`isPartial`); `turnBaseUsd` when the current turn began.
export type Spend = {
  resetsAt: string | null
  baseUsd: number
  isPartial: boolean
  lastUsd: number
  turnBaseUsd: number
}

declare module 'claude-code' {
  interface PluginState {
    'orbit-hud': {
      usage: Usage | null
      work: Work
      spend: Spend | null
    }
  }
}
