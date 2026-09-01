import { fitCanvas } from './view.js'
import { tuningColor } from '../core/notes.js'
import { labelFor } from '../core/sargam.js'

// One cell per beat, showing the note that occupied most of that beat. This is
// the rhythm read-out: what did I sing on beat 1, 2, 3, 4.
export function drawBeatLane (canvas, { view, transport, segs, now }) {
  const { ctx, w, h } = fitCanvas(canvas)
  const start = view.viewStart(now)
  const end = view.viewEnd(now)
  const xFor = t => ((t - start) / (end - start)) * w

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#0a0d13'
  ctx.fillRect(0, 0, w, h)

  const beatDur = transport.beatDuration()
  const first = Math.max(0, Math.floor(start / beatDur))
  const last = Math.ceil(end / beatDur)

  for (let b = first; b <= last; b++) {
    const t0 = b * beatDur
    const t1 = t0 + beatDur
    const x0 = xFor(t0)
    const x1 = xFor(t1)
    const beatInBar = b % transport.state.beatsPerBar
    const isDown = beatInBar === 0

    ctx.fillStyle = isDown ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)'
    ctx.fillRect(x0 + 1, 4, x1 - x0 - 2, h - 8)

    // Longest-overlapping segment wins the beat.
    let best = null
    let bestOverlap = 0
    for (const s of segs) {
      const ov = Math.min(s.end, t1) - Math.max(s.start, t0)
      if (ov > bestOverlap) { bestOverlap = ov; best = s }
    }

    ctx.font = '11px ' + view.labelFont
    if (best && bestOverlap > beatDur * 0.25) {
      ctx.fillStyle = tuningColor(best.cents, 0.28)
      ctx.fillRect(x0 + 1, 4, x1 - x0 - 2, h - 8)
      ctx.fillStyle = tuningColor(best.cents, 1)
      ctx.fillText(labelFor(best.semitone, view, { short: true }), x0 + 6, h / 2 + 4)
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.2)'
      ctx.fillText('–', x0 + 6, h / 2 + 4)
    }

    ctx.fillStyle = isDown ? 'rgba(140,190,255,0.85)' : 'rgba(255,255,255,0.3)'
    ctx.font = '9px ui-monospace, Menlo, monospace'
    ctx.fillText(String(beatInBar + 1), x0 + 4, 12)

    ctx.strokeStyle = isDown ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)'
    ctx.beginPath()
    ctx.moveTo(Math.round(x0) + 0.5, 0)
    ctx.lineTo(Math.round(x0) + 0.5, h)
    ctx.stroke()
  }
}
