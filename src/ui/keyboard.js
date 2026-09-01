import { fitCanvas } from './view.js'
import { isBlackKey, noteName, tuningColor, pitchClass } from '../core/notes.js'
import { sargamName, isSa } from '../core/sargam.js'

const PLAYED = '#ffb347'   // a key you pressed, as opposed to one you sang

// Key geometry, shared by the renderer and the hit test so a click always lands
// on the key it looks like it landed on.
export function pianoLayout (view, w) {
  const lo = Math.floor(view.low)
  const hi = Math.ceil(view.high)
  const whites = []
  for (let m = lo; m <= hi; m++) if (!isBlackKey(m)) whites.push(m)
  const kw = w / Math.max(1, whites.length)
  const xOfWhite = new Map(whites.map((m, i) => [m, i * kw]))
  return { lo, hi, whites, kw, xOfWhite, blackW: kw * 0.62 }
}

// Black keys sit on top, so they are tested first.
export function pianoKeyAt (view, w, h, x, y) {
  const L = pianoLayout(view, w)
  if (y <= h * 0.62) {
    for (let m = L.lo; m <= L.hi; m++) {
      if (!isBlackKey(m)) continue
      const left = L.xOfWhite.get(m - 1)
      if (left == null) continue
      const bx = left + L.kw - L.blackW / 2
      if (x >= bx && x <= bx + L.blackW) return m
    }
  }
  for (const m of L.whites) {
    const kx = L.xOfWhite.get(m)
    if (x >= kx && x <= kx + L.kw) return m
  }
  return null
}

// Which semitone row of the vertical rail a y-pixel falls in.
export function railMidiAt (view, h, y) {
  const span = view.high - view.low
  return Math.round(view.low + ((h - y) / h) * span - 0.5)
}

// Vertical keyboard: doubles as the timeline's Y-axis legend, so one semitone
// row on the graph is literally the same height as its key.
export function drawKeyRail (canvas, { view, active, recent, playing }) {
  const { ctx, w, h } = fitCanvas(canvas)
  const span = view.high - view.low
  const rowH = h / span
  const yFor = m => h - ((m - view.low) / span) * h

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#0a0d13'
  ctx.fillRect(0, 0, w, h)

  for (let m = Math.floor(view.low); m <= Math.ceil(view.high); m++) {
    const y = yFor(m + 0.5)
    const black = isBlackKey(m)
    const kw = black ? w * 0.62 : w
    const age = recent.get(m)
    const isActive = active === m
    const isPlaying = playing?.has(m)

    ctx.fillStyle = black ? '#171d27' : '#e8edf5'
    if (age != null) {
      const a = Math.max(0, 1 - age / 2.5)
      ctx.fillStyle = isActive ? 'rgba(90,220,255,0.95)' : `rgba(90,200,255,${0.15 + 0.5 * a})`
    }
    if (isPlaying) ctx.fillStyle = PLAYED
    ctx.fillRect(0, y + 0.5, kw, rowH - 1)

    ctx.strokeStyle = 'rgba(0,0,0,0.55)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, y + 0.5, kw, rowH - 1)

    // Anchor rows (Sa, or C in western mode) are always labelled; every row
    // gets a label once the rows are tall enough to hold one.
    const anchor = view.labelMode === 'west' ? pitchClass(m) === 0 : isSa(m, view.saMidi)
    if (rowH > 9 && (anchor || rowH > 14)) {
      const text = labelText(m, view, !anchor)
      ctx.fillStyle = age != null || black ? 'rgba(226,236,248,0.75)' : '#2a3140'
      if (!black && age == null) ctx.fillStyle = anchor ? '#1d2531' : '#5c6675'
      if (isPlaying) ctx.fillStyle = '#3a2708'
      ctx.font = (anchor ? 'bold ' : '') + '9px ' + view.labelFont
      const tw = ctx.measureText(text).width
      ctx.fillText(text, Math.max(2, w - tw - 4), y + rowH - Math.max(3, (rowH - 8) / 2))
    }
  }
}

// Classic proportional keyboard along the bottom.
export function drawPiano (canvas, { view, active, recent, cents, playing }) {
  const { ctx, w, h } = fitCanvas(canvas)
  ctx.clearRect(0, 0, w, h)
  const L = pianoLayout(view, w)
  if (!L.whites.length) return

  for (const m of L.whites) {
    const x = L.xOfWhite.get(m)
    const age = recent.get(m)
    let fill = '#eef2f8'
    if (age != null) {
      const a = Math.max(0, 1 - age / 2.5)
      fill = `rgba(120,205,255,${0.25 + 0.6 * a})`
    }
    if (active === m) fill = cents == null ? '#5ad9ff' : tuningColor(cents, 1)
    if (playing?.has(m)) fill = PLAYED
    ctx.fillStyle = fill
    ctx.fillRect(x, 0, L.kw - 1, h)
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.strokeRect(x + 0.5, 0.5, L.kw - 1, h - 1)
    drawKeyLabel(ctx, m, view, x, L.kw, h, false)
  }

  for (let m = L.lo; m <= L.hi; m++) {
    if (!isBlackKey(m)) continue
    const leftWhite = L.xOfWhite.get(m - 1)
    if (leftWhite == null) continue
    const x = leftWhite + L.kw - L.blackW / 2
    const age = recent.get(m)
    let fill = '#12161f'
    if (age != null) {
      const a = Math.max(0, 1 - age / 2.5)
      fill = `rgba(70,170,235,${0.35 + 0.6 * a})`
    }
    if (active === m) fill = cents == null ? '#5ad9ff' : tuningColor(cents, 1)
    if (playing?.has(m)) fill = PLAYED
    ctx.fillStyle = fill
    ctx.fillRect(x, 0, L.blackW, h * 0.62)
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.strokeRect(x + 0.5, 0.5, L.blackW, h * 0.62)
    drawKeyLabel(ctx, m, view, x, L.blackW, h * 0.62, !playing?.has(m))
  }
}

function labelText (midi, view, short) {
  if (view.labelMode === 'west') return noteName(midi, view.useFlats)
  const script = view.labelMode === 'punjabi' || view.bothScript === 'punjabi' ? 'punjabi' : 'latin'
  const swara = sargamName(midi, view.saMidi, { script, short })
  return view.labelMode === 'both' ? swara : swara
}

// One label per key: western name, swara, or both stacked. Skipped when the key
// is too narrow to hold the text.
function drawKeyLabel (ctx, midi, view, x, kw, h, dark) {
  const anchor = view.labelMode === 'west' ? pitchClass(midi) === 0 : isSa(midi, view.saMidi)
  const west = noteName(midi, view.useFlats)
  const swara = view.labelMode === 'west' ? null : labelText(midi, view, false)

  const lines = []
  if (view.labelMode === 'west') lines.push(west)
  else if (view.labelMode === 'both') { lines.push(swara); lines.push(west) }
  else lines.push(swara)

  ctx.textAlign = 'center'
  const cx = x + kw / 2
  let y = h - 6 - (lines.length - 1) * 11
  for (let i = 0; i < lines.length; i++) {
    const primary = i === 0
    ctx.font = (anchor && primary ? 'bold ' : '') + (primary ? 11 : 9) + 'px ' + view.labelFont
    if (ctx.measureText(lines[i]).width > kw - 3) { y += primary ? 11 : 0; continue }
    ctx.fillStyle = dark
      ? (primary ? 'rgba(236,243,252,0.92)' : 'rgba(236,243,252,0.55)')
      : (anchor && primary ? '#0f1622' : primary ? 'rgba(20,26,36,0.8)' : 'rgba(20,26,36,0.5)')
    ctx.fillText(lines[i], cx, y)
    y += 11
  }
  ctx.textAlign = 'left'
}
