// Shared view state. The timeline, the vertical keyboard and the beat lane all
// map pitch and time through this object so their rows stay aligned.

export function createView () {
  const v = {
    low: 36,            // displayed MIDI window (fractional, eased)
    high: 84,
    targetLow: 36,
    targetHigh: 84,
    autoRange: true,
    timeWindow: 8,      // seconds visible
    scrollBack: 0,      // seconds behind the live edge
    frozen: false,
    hoverTime: null,
    inspectTime: null,  // clicked moment, null = follow live
    useFlats: false,
    tonic: 11,               // pitch class of Sa; kept in sync with saMidi
    scaleDegrees: null,      // null = chromatic, else offsets from Sa
    saMidi: 47,              // B2 — the singer's Sa, changeable
    labelMode: 'both',       // 'west' | 'sargam' | 'punjabi' | 'both'
    bothScript: 'punjabi',   // which script the sargam half of 'both' uses
    // Latin falls to the mono face, Gurmukhi to the first family that has it.
    labelFont: "ui-monospace, Menlo, 'Noto Sans Gurmukhi', 'Gurmukhi MN', 'Gurmukhi Sangam MN', monospace"
  }

  v.setSa = midi => { v.saMidi = midi; v.tonic = ((midi % 12) + 12) % 12 }

  v.viewEnd = now => Math.max(v.timeWindow, now) - v.scrollBack
  v.viewStart = now => v.viewEnd(now) - v.timeWindow

  v.ease = () => {
    v.low += (v.targetLow - v.low) * 0.08
    v.high += (v.targetHigh - v.high) * 0.08
  }

  // Widen the window to whatever the singer is actually producing, with a few
  // semitones of headroom, then hold at a minimum of two octaves.
  v.fitTo = (min, max) => {
    if (!v.autoRange || !isFinite(min) || !isFinite(max)) return
    let lo = Math.floor(min) - 3
    let hi = Math.ceil(max) + 3
    const span = hi - lo
    if (span < 24) {
      const pad = (24 - span) / 2
      lo -= pad; hi += pad
    }
    v.targetLow = Math.max(24, lo)
    v.targetHigh = Math.min(96, hi)
  }

  v.zoomPitch = factor => {
    v.autoRange = false
    const mid = (v.targetLow + v.targetHigh) / 2
    let half = ((v.targetHigh - v.targetLow) / 2) * factor
    half = Math.max(6, Math.min(36, half))
    v.targetLow = Math.max(24, mid - half)
    v.targetHigh = Math.min(96, mid + half)
  }

  return v
}

export function fitCanvas (canvas) {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const w = Math.max(1, Math.round(rect.width * dpr))
  const h = Math.max(1, Math.round(rect.height * dpr))
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w: rect.width, h: rect.height }
}

// Turn the raw per-frame stream into held notes: runs of frames that agree on
// the same semitone and last long enough to count as sung rather than passed
// through on the way somewhere else.
export function buildSegments (frames, { from = -Infinity, to = Infinity, minDur = 0.06 } = {}) {
  const segs = []
  let cur = null
  for (const f of frames) {
    if (f.t < from || f.t > to) { if (f.t > to) break; continue }
    const voiced = f.midi > 0
    const semitone = voiced ? Math.round(f.midi) : null
    if (cur && (!voiced || semitone !== cur.semitone || f.t - cur.end > 0.12)) {
      if (cur.end - cur.start >= minDur) segs.push(finish(cur))
      cur = null
    }
    if (voiced) {
      if (!cur) cur = { semitone, start: f.t, end: f.t, sum: 0, n: 0, min: f.midi, max: f.midi }
      cur.end = f.t
      cur.sum += f.midi
      cur.n++
      cur.min = Math.min(cur.min, f.midi)
      cur.max = Math.max(cur.max, f.midi)
    }
  }
  if (cur && cur.end - cur.start >= minDur) segs.push(finish(cur))
  return segs
}

function finish (s) {
  s.mean = s.sum / s.n
  s.cents = (s.mean - s.semitone) * 100
  s.vibrato = (s.max - s.min) * 100
  return s
}
