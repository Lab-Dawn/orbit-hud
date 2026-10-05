// Pixel art: the core, the row cores, gauges, markers, and pixel lettering. Every
// piece is drawn at its true size on a small canvas and shown enlarged with hard
// pixel edges (image-rendering: pixelated), so it stays crisp at any display scale.

const COLORS = {
  Accent: '#22D3EE',
  Text: '#E6EDF3',
  Sub: '#C5CED8',
  Muted: '#7D8A99',
  Faint: '#5C6773',
  Warn: '#F5B841',
  Danger: '#FF5C6C',
  Ask: '#A78BFA',
  Done: '#4ADE80',
}

const PALETTES = {
  cyan: ['#F2FFFF', '#B8F6FF', '#5CE1F5', '#22B8D6', '#137A93', '#0B4656'],
  violet: ['#F6F0FF', '#D9CCFF', '#B49BFF', '#8B6CF0', '#5B44A8', '#33265F'],
  green: ['#EFFFF4', '#A8F5C3', '#4ADE80', '#22A55A', '#137A3F', '#0B4626'],
}
const RING = {
  Accent: ['#5CE1F5', '#B8F6FF'],
  Warn: ['#FFB13B', '#FFE0A3'],
  Danger: ['#FF4D5E', '#FFB0B8'],
}
const PX = {
  outline: '#06090D',
  housing: '#18202A',
  track: '#222C38',
  trackHi: '#2C3947',
  lampOff: '#344050',
  glow: { cyan: 'rgba(92,225,245,0.43)', violet: 'rgba(180,155,255,0.43)' },
}

function level(pct) {
  return pct >= 85 ? 'Danger' : pct >= 60 ? 'Warn' : 'Accent'
}

function rgba(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 255] : null
}

// A canvas shown k times its size with hard pixel edges.
function pixelCanvas(w, h, k) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.style.width = `${w * k}px`
  c.style.height = `${h * k}px`
  c.className = 'px'
  return c
}

// ---------- the core: 32x32 ----------

const N = 32
const MID = (N - 1) / 2

// What each pixel is, from its distance and angle to the centre: 1 outline, 2/3 usage
// ring (inner/outer half), 4/5 coil (inner/outer), 6 gap between coils, 7..9 the core
// from rim to heart, 10 halo (only while lit).
const ROLE = new Uint8Array(N * N)
const ANGLE = new Float32Array(N * N)
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const dx = x - MID
    const dy = y - MID
    const d = Math.sqrt(dx * dx + dy * dy)
    const a = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
    const i = y * N + x
    ANGLE[i] = a
    ROLE[i] =
      d > 16.4 ? 0
      : d > 15.6 ? ((x + y) % 2 === 0 ? 10 : 0)
      : d > 13.6 ? 0
      : d > 13.0 ? 1
      : d > 10.4 ? (d < 11.3 ? 2 : 3)
      : d > 9.8 ? 1
      : d > 7.2 ? (a % 36 < 27 ? (d > 9.0 ? 5 : 4) : 6)
      : d > 6.4 ? 1
      : d > 4.8 ? 7
      : d > 2.8 ? 8
      : 9
  }
}

// Twelve 2x2 lamps around the rim, clockwise from twelve o'clock.
const LAMPS = []
for (let k = 0; k < 12; k++) {
  const rad = (k * 30 * Math.PI) / 180
  LAMPS.push([Math.round(MID + 14.6 * Math.sin(rad) - 0.5), Math.round(MID - 14.6 * Math.cos(rad) - 0.5)])
}

const coreBases = new Map()
function coreBase(mode, shift, pct) {
  const key = `${mode}|${shift}|${pct}`
  if (coreBases.has(key)) return coreBases.get(key)
  if (coreBases.size > 24) coreBases.clear()
  const hue = mode === 'ask' ? 'violet' : 'cyan'
  const pal = PALETTES[hue]
  const ring = RING[level(pct)]
  const sweep = pct * 3.6
  const colorOf = {
    1: PX.outline,
    4: pal[Math.min(5, 3 + shift)],
    5: pal[Math.min(5, 4 + shift)],
    6: PX.housing,
    7: pal[2 + shift],
    8: pal[1 + shift],
    9: pal[0 + shift],
  }
  const cells = []
  for (let i = 0; i < N * N; i++) {
    const role = ROLE[i]
    if (role === 0) continue
    let color = null
    if (role === 2 || role === 3) {
      const isFilled = pct > 0 && ANGLE[i] <= sweep
      color = role === 2 ? (isFilled ? ring[1] : PX.trackHi) : isFilled ? ring[0] : PX.track
    } else if (role === 10) {
      if (mode !== 'idle') color = PX.glow[hue]
    } else {
      color = colorOf[role]
    }
    if (color) cells.push([i % N, Math.floor(i / N), color])
  }
  coreBases.set(key, cells)
  return cells
}

// idle: one shade down, lamps dark. working: a lamp runs round with a fading tail and
// the core pulses between two shades. ask: the same, in violet.
function drawCore(ctx, mode, frame, pct) {
  pct = Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10
  const shift = mode === 'idle' ? 1 : frame % 4 < 2 ? 0 : 1
  ctx.clearRect(0, 0, N, N)
  for (const [x, y, color] of coreBase(mode, shift, pct)) {
    ctx.fillStyle = color
    ctx.fillRect(x, y, 1, 1)
  }
  const pal = PALETTES[mode === 'ask' ? 'violet' : 'cyan']
  for (let k = 0; k < 12; k++) {
    let color = PX.lampOff
    if (mode !== 'idle') {
      const behind = (frame - k + 1200) % 12
      color = behind === 0 ? pal[1] : behind === 1 ? pal[2] : behind === 2 ? pal[3] : pal[4]
    }
    ctx.fillStyle = color
    ctx.fillRect(LAMPS[k][0], LAMPS[k][1], 2, 2)
  }
}

// ---------- the row cores: 12x12 ----------

const MINI = 12
function drawMini(ctx, hue, shift, lit) {
  const pal = PALETTES[hue]
  const mid = (MINI - 1) / 2
  ctx.clearRect(0, 0, MINI, MINI)
  for (let y = 0; y < MINI; y++) {
    for (let x = 0; x < MINI; x++) {
      const dx = x - mid
      const dy = y - mid
      const d = Math.sqrt(dx * dx + dy * dy)
      const a = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
      let color = null
      if (d > 5.7) continue
      else if (d > 4.5) {
        color = pal[4]
        if (lit >= 0) {
          const behind = (lit - Math.floor(a / 45) + 8) % 8
          if (behind === 0) color = pal[1]
          else if (behind === 1) color = pal[2]
          else if (behind === 2) color = pal[3]
        }
      } else if (d > 3.5) color = PX.outline
      else if (d > 2.0) color = pal[2 + shift]
      else color = pal[0 + shift]
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
    }
  }
}

// state: idle | done | working | ask; frame turns the lamp.
function drawMiniState(ctx, state, frame) {
  if (state === 'working') drawMini(ctx, 'cyan', frame % 2, frame % 8)
  else if (state === 'ask') drawMini(ctx, 'violet', frame % 2, frame % 8)
  else if (state === 'done') drawMini(ctx, 'green', 0, -1)
  else drawMini(ctx, 'cyan', 3, -1)
}

// ---------- context gauge: ten cells ----------

const GAUGE_W = 29
const GAUGE_H = 6
function drawGauge(ctx, pct) {
  const filled = Math.round(Math.max(0, Math.min(100, pct)) / 10)
  const [main, hi] = RING[level(pct)]
  ctx.clearRect(0, 0, GAUGE_W, GAUGE_H)
  for (let cell = 0; cell < 10; cell++) {
    const isOn = cell < filled
    ctx.fillStyle = isOn ? hi : PX.trackHi
    ctx.fillRect(cell * 3, 0, 2, 1)
    ctx.fillStyle = isOn ? main : PX.track
    ctx.fillRect(cell * 3, 1, 2, GAUGE_H - 1)
  }
}

// ---------- option markers: a cut-corner ring for one choice, a box for many ----------

function drawMarker(ctx, isMulti, isOn) {
  const n = 7
  const edge = isOn ? PALETTES.violet[2] : '#5C6773'
  const fill = PALETTES.violet[0]
  const check = ['1,3', '2,4', '3,3', '4,2', '5,1']
  ctx.clearRect(0, 0, n, n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const isEdge = x === 0 || y === 0 || x === n - 1 || y === n - 1
      const isCorner = (x === 0 || x === n - 1) && (y === 0 || y === n - 1)
      let color = null
      if (isMulti) {
        if (isEdge) color = edge
        else if (isOn && check.includes(`${x},${y}`)) color = fill
      } else if (isEdge && !isCorner) color = edge
      else if (isOn && x >= 2 && x <= 4 && y >= 2 && y <= 4) color = fill
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
    }
  }
}

// The send arrow, 7x8.
function drawArrow(ctx) {
  const art = ['...#...', '..###..', '.#.#.#.', '#..#..#', '...#...', '...#...', '...#...', '...#...']
  ctx.fillStyle = PALETTES.cyan[2]
  art.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && ctx.fillRect(x, y, 1, 1)))
}

// Small hand-drawn marks, 7x7: close and jump (the font has neither in pixel form).
const ICONS = {
  close: ['#.....#', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#.....#'],
  jump: ['..#####', '.....##', '....#.#', '...#..#', '..#....', '.#.....', '#......'],
}
function icon(name, color, k = 2) {
  const art = ICONS[name]
  const c = pixelCanvas(7, 7, k)
  const ctx = c.getContext('2d')
  ctx.fillStyle = COLORS[color] || color
  art.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && ctx.fillRect(x, y, 1, 1)))
  return c
}

// ---------- pixel lettering: Galmuri14 at its own size, enlarged twice ----------

const FONT_PX = 15
const LINE = 19
const ZOOM = 2
const FONT = `${FONT_PX}px Galmuri14`
const measurer = document.createElement('canvas').getContext('2d')

function measure(text) {
  measurer.font = FONT
  return Math.ceil(measurer.measureText(text).width)
}

// A leading check mark is drawn by hand, as a clean pixel tick.
const CHECK_W = 12
function partWidth(text) {
  if (!text) return 0
  if (text.startsWith('✓')) return CHECK_W + measure(text.slice(1))
  return measure(text)
}

// parts: [[text, colourName], ...]. One line, cut with an ellipsis past maxWidth
// (screen pixels), or with wrap the first part broken over lines to fit.
function pixelText(parts, { maxWidth = 0, wrap = false } = {}) {
  if (typeof parts[0] === 'string') parts = [parts]
  const limit = maxWidth > 0 ? Math.floor(maxWidth / ZOOM) : 100000
  const lines = []
  if (wrap) {
    const [text, color] = parts[0]
    let line = ''
    for (const ch of String(text)) {
      const next = line + ch
      if (line && partWidth(next) > limit) {
        const cut = line.lastIndexOf(' ')
        if (cut > 0) {
          lines.push([[line.slice(0, cut), color]])
          line = line.slice(cut + 1) + ch
        } else {
          lines.push([[line, color]])
          line = ch
        }
      } else line = next
    }
    if (line) lines.push([[line, color]])
  } else {
    const kept = []
    let used = 0
    const ellipsis = partWidth('…')
    for (const [raw, color] of parts) {
      let text = String(raw ?? '')
      const w = partWidth(text)
      if (used + w <= limit) {
        kept.push([text, color])
        used += w
        continue
      }
      while (text.length > 0 && used + partWidth(text) + ellipsis > limit) text = text.slice(0, -1)
      kept.push([`${text}…`, color])
      break
    }
    lines.push(kept)
  }
  let width = 1
  for (const l of lines) width = Math.max(width, l.reduce((sum, [t]) => sum + partWidth(t), 0))
  const c = pixelCanvas(width + 1, Math.max(1, lines.length) * LINE, ZOOM)
  const ctx = c.getContext('2d')
  ctx.font = FONT
  ctx.textBaseline = 'top'
  lines.forEach((l, row) => {
    let x = 0
    const y = row * LINE + 2
    for (let [text, color] of l) {
      ctx.fillStyle = COLORS[color] || color
      if (text.startsWith('✓')) {
        for (const [dx, dy] of [[1, 7], [2, 8], [3, 9], [4, 8], [5, 7], [6, 6], [7, 5], [8, 4]]) ctx.fillRect(x + dx, y + dy - 1, 1, 2)
        x += CHECK_W
        text = text.slice(1)
      }
      if (text) {
        ctx.fillText(text, x, y)
        x += measure(text)
      }
    }
  })
  // Hard pixels only: whatever the browser smoothed is either in or out.
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0
  ctx.putImageData(img, 0, 0)
  return c
}

window.Pixel = {
  COLORS, PALETTES, N, MINI, GAUGE_W, GAUGE_H, LINE, ZOOM,
  level, pixelCanvas, icon, drawCore, drawMiniState, drawGauge, drawMarker, drawArrow, pixelText, partWidth, rgba,
}
