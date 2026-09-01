import { fitCanvas, buildSegments } from './view.js'
import { isBlackKey, tuningColor, inDegrees } from '../core/notes.js'
import { labelFor, isSa } from '../core/sargam.js'

// The main piano-roll: quantised note blocks with the true pitch curve drawn on
// top, over a grid whose vertical lines are beats and bars.

export function drawTimeline (canvas, { view, frames, transport, now }) {
  const { ctx, w, h } = fitCanvas(canvas)
  const start = view.viewStart(now)
  const end = view.viewEnd(now)
  const span = view.high - view.low
  const rowH = h / span

  const xFor = t => ((t - start) / (end - start)) * w
  const yFor = m => h - ((m - view.low) / span) * h

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#0c1017'
  ctx.fillRect(0, 0, w, h)

  // --- pitch rows -----------------------------------------------------------
  const loRow = Math.floor(view.low)
  const hiRow = Math.ceil(view.high)
  for (let m = loRow; m <= hiRow; m++) {
    const y = yFor(m + 0.5)
    const black = isBlackKey(m)
    const outOfKey = !inDegrees(m, view.tonic, view.scaleDegrees)
    ctx.fillStyle = black ? 'rgba(255,255,255,0.028)' : 'rgba(255,255,255,0.012)'
    if (outOfKey) ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.fillRect(0, y, w, rowH)

    // The anchor row is Sa in any sargam mode, C in western mode.
    const anchor = view.labelMode === 'west' ? m % 12 === 0 : isSa(m, view.saMidi)
    ctx.strokeStyle = anchor ? 'rgba(120,170,255,0.28)' : 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, Math.round(y) + 0.5)
    ctx.lineTo(w, Math.round(y) + 0.5)
    ctx.stroke()

    if (anchor && rowH > 8) {
      ctx.fillStyle = 'rgba(140,180,255,0.5)'
      ctx.font = '10px ' + view.labelFont
      ctx.fillText(labelFor(m, view), 4, y + rowH - 3)
    }
  }

  // --- beat / bar grid ------------------------------------------------------
  const beatDur = transport.beatDuration()
  const firstBeat = Math.floor(start / beatDur)
  const lastBeat = Math.ceil(end / beatDur)
  ctx.font = '10px ui-monospace, Menlo, monospace'
  for (let b = firstBeat; b <= lastBeat; b++) {
    if (b < 0) continue
    const x = Math.round(xFor(b * beatDur)) + 0.5
    const isBar = b % transport.state.beatsPerBar === 0
    ctx.strokeStyle = isBar ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)'
    ctx.lineWidth = isBar ? 1.5 : 1
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
    if (isBar) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillText('bar ' + (b / transport.state.beatsPerBar + 1), x + 4, 12)
    }
  }

  // --- note blocks ----------------------------------------------------------
  const segs = buildSegments(frames, { from: start - 1, to: end })
  for (const s of segs) {
    const x0 = xFor(s.start)
    const x1 = Math.max(x0 + 2, xFor(s.end))
    const y = yFor(s.semitone + 0.5)
    ctx.fillStyle = tuningColor(s.cents, 0.32)
    ctx.fillRect(x0, y + 1, x1 - x0, rowH - 2)
    ctx.strokeStyle = tuningColor(s.cents, 0.9)
    ctx.lineWidth = 1
    ctx.strokeRect(x0 + 0.5, y + 1.5, x1 - x0 - 1, rowH - 3)

    const text = labelFor(s.semitone, view, { short: true })
    if (x1 - x0 > 8 + text.length * 6 && rowH > 11) {
      ctx.fillStyle = 'rgba(255,255,255,0.82)'
      ctx.font = '10px ' + view.labelFont
      ctx.fillText(text, x0 + 4, y + rowH / 2 + 3.5)
    }
  }

  // --- continuous pitch curve ----------------------------------------------
  ctx.lineWidth = 1.8
  ctx.strokeStyle = 'rgba(230,244,255,0.95)'
  ctx.shadowColor = 'rgba(120,200,255,0.7)'
  ctx.shadowBlur = 6
  ctx.beginPath()
  let pen = false
  for (const f of frames) {
    if (f.t < start - 0.1) continue
    if (f.t > end) break
    if (f.midi <= 0) { pen = false; continue }
    const x = xFor(f.t)
    const y = yFor(f.midi + 0.5)
    if (!pen) { ctx.moveTo(x, y); pen = true } else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.shadowBlur = 0

  // --- playhead + inspect cursor -------------------------------------------
  const headX = xFor(Math.min(now, end))
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(headX, 0)
  ctx.lineTo(headX, h)
  ctx.stroke()

  const cursor = view.inspectTime ?? view.hoverTime
  if (cursor != null && cursor >= start && cursor <= end) {
    const cx = xFor(cursor)
    ctx.strokeStyle = view.inspectTime != null ? 'rgba(255,214,102,0.95)' : 'rgba(255,255,255,0.3)'
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx, h)
    ctx.stroke()
    ctx.setLineDash([])
  }

  return { xFor, yFor, start, end, segs }
}

// Time under the pointer, for hover and click-to-inspect.
export function timeAtX (canvas, clientX, view, now) {
  const rect = canvas.getBoundingClientRect()
  const ratio = (clientX - rect.left) / rect.width
  return view.viewStart(now) + ratio * view.timeWindow
}
