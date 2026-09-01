import { fitCanvas } from './view.js'
import { tuningColor } from '../core/notes.js'

// -50…+50 cent tuning meter. Centred and green means you are on the note.
export function drawMeter (canvas, { cents, live }) {
  const { ctx, w, h } = fitCanvas(canvas)
  ctx.clearRect(0, 0, w, h)

  const midY = h * 0.62
  const pad = 10
  const usable = w - pad * 2
  const xFor = c => pad + ((c + 50) / 100) * usable

  // Tolerance bands behind the scale.
  ctx.fillStyle = 'rgba(34,197,94,0.14)'
  ctx.fillRect(xFor(-12), midY - 14, xFor(12) - xFor(-12), 28)
  ctx.fillStyle = 'rgba(245,158,11,0.09)'
  ctx.fillRect(xFor(-30), midY - 14, xFor(-12) - xFor(-30), 28)
  ctx.fillRect(xFor(12), midY - 14, xFor(30) - xFor(12), 28)

  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(pad, midY)
  ctx.lineTo(w - pad, midY)
  ctx.stroke()

  ctx.font = '9px ui-monospace, Menlo, monospace'
  for (let c = -50; c <= 50; c += 10) {
    const x = xFor(c)
    const major = c % 50 === 0 || c === 0
    ctx.strokeStyle = c === 0 ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.22)'
    ctx.beginPath()
    ctx.moveTo(x, midY - (major ? 14 : 7))
    ctx.lineTo(x, midY + (major ? 14 : 7))
    ctx.stroke()
    if (major) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.fillText(c > 0 ? '+' + c : String(c), x - 8, h - 2)
    }
  }

  if (!live || cents == null) return
  const c = Math.max(-50, Math.min(50, cents))
  const x = xFor(c)
  ctx.fillStyle = tuningColor(cents, 1)
  ctx.shadowColor = tuningColor(cents, 0.8)
  ctx.shadowBlur = 12
  ctx.beginPath()
  ctx.moveTo(x, midY - 20)
  ctx.lineTo(x + 6, midY - 30)
  ctx.lineTo(x - 6, midY - 30)
  ctx.closePath()
  ctx.fill()
  ctx.fillRect(x - 1.5, midY - 18, 3, 36)
  ctx.shadowBlur = 0
}
