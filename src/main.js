// Gurmukhi is bundled rather than assumed: not every machine has a Gurmukhi
// system face, and canvas text silently falls back to tofu when one is missing.
import '@fontsource/noto-sans-gurmukhi/400.css'
import '@fontsource/noto-sans-gurmukhi/700.css'

import { createEngine } from './audio/engine.js'
import { createSynth } from './audio/synth.js'
import { createTransport } from './core/transport.js'
import { createView, buildSegments } from './ui/view.js'
import { drawTimeline, timeAtX } from './ui/timeline.js'
import { drawKeyRail, drawPiano, pianoKeyAt, railMidiAt } from './ui/keyboard.js'
import { drawBeatLane } from './ui/beatlane.js'
import { drawMeter } from './ui/meter.js'
import { noteName, centsOff, midiToFreq, tuningColor, SHARP_NAMES, SCALES } from './core/notes.js'
import { labelFor, dualLabel, sargamName, swaraOf, THAATS } from './core/sargam.js'

const $ = id => document.getElementById(id)

const view = createView()
const engine = createEngine()
// ensureCtx rather than engine.ctx: the metronome and the keyboard synth both
// need to make sound before the microphone has ever been started.
const transport = createTransport(() => engine.ensureCtx(), () => engine.now)
const synth = createSynth(() => engine.ensureCtx())

let frozenNow = 0
let lastVoiced = null      // most recent confidently voiced frame
let historySig = 0

// ---------------------------------------------------------------- controls --
// Sa selector: pitch class + octave. B2 is the default because it is a common
// male-voice Sa, but any note works.
SHARP_NAMES.forEach((n, i) => {
  const opt = document.createElement('option')
  opt.value = i
  opt.textContent = n
  $('saNoteSel').appendChild(opt)
})
for (let oct = 1; oct <= 5; oct++) {
  const opt = document.createElement('option')
  opt.value = oct
  opt.textContent = oct
  $('saOctSel').appendChild(opt)
}

function applySa () {
  const pc = Number($('saNoteSel').value)
  const oct = Number($('saOctSel').value)
  view.setSa((oct + 1) * 12 + pc)
  $('saLabel') && ($('saLabel').textContent = noteName(view.saMidi))
}
$('saNoteSel').value = String(view.saMidi % 12)
$('saOctSel').value = String(Math.floor(view.saMidi / 12) - 1)
$('saNoteSel').onchange = applySa
$('saOctSel').onchange = applySa
applySa()

const SAPTAK_NAMES = { '-2': 'ati-mandra', '-1': 'mandra ਮੰਦਰ', 0: 'madhya ਮੱਧ', 1: 'taar ਤਾਰ', 2: 'ati-taar' }

async function refreshDevices () {
  try {
    const devices = await engine.listDevices()
    const sel = $('deviceSel')
    // Keep whatever is already in use selected — re-selecting a different entry
    // here would trigger a device switch, and with it a new permission prompt.
    const keep = engine.currentDeviceId() || sel.value
    sel.innerHTML = ''
    devices.forEach(d => {
      const opt = document.createElement('option')
      opt.value = d.deviceId
      opt.textContent = d.label || 'Microphone'
      sel.appendChild(opt)
    })
    if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep
  } catch { /* labels need permission first; retried after start */ }
}

async function startMic () {
  try {
    await engine.start($('deviceSel').value || undefined)
    $('gate').classList.add('hidden')
    $('recBtn').classList.add('on')
    $('recBtn').textContent = '■ Stop'
    refreshDevices()
  } catch (err) {
    alert('Could not open the microphone: ' + err.message)
  }
}

function stopMic () {
  engine.stop()
  $('recBtn').classList.remove('on')
  $('recBtn').textContent = '● Start'
}

$('gateBtn').onclick = startMic
$('recBtn').onclick = () => (engine.running ? stopMic() : startMic())
$('clearBtn').onclick = () => { engine.clear(); view.scrollBack = 0 }
$('deviceSel').onchange = async () => {
  if (!engine.state.stream) return
  if ($('deviceSel').value === engine.currentDeviceId()) return
  engine.release()          // switching devices genuinely needs a new stream
  await startMic()
}
window.addEventListener('beforeunload', () => engine.release())
$('a4').oninput = e => engine.setA4(Number(e.target.value) || 440)
$('bpm').oninput = e => { transport.state.bpm = Math.max(30, Number(e.target.value) || 80) }
$('meterSel').onchange = e => { transport.state.beatsPerBar = Number(e.target.value) }
$('clickChk').onchange = e => transport.setClick(e.target.checked)
$('scaleSel').onchange = e => {
  const name = e.target.value
  view.scaleDegrees = THAATS[name] || (name === 'chromatic' ? null : SCALES[name])
}
$('labelSel').onchange = e => { view.labelMode = e.target.value }
$('autoChk').onchange = e => { view.autoRange = e.target.checked }
$('flatChk').onchange = e => { view.useFlats = e.target.checked }

$('freezeBtn').onclick = () => {
  view.frozen = !view.frozen
  frozenNow = engine.now
  $('freezeBtn').classList.toggle('on', view.frozen)
}

$('soundChk').onchange = e => { if (!e.target.checked) synth.allOff() }
$('sustainChk').onchange = e => { if (!e.target.checked) synth.allOff() }
$('vol').oninput = e => synth.setVolume(Number(e.target.value) / 100)

// ------------------------------------------------------- playable keyboards --
// Press a key to hear it. With `sustain` on, a press latches the note so a
// reference tone (or a two-note drone) keeps ringing while you sing.
// Pointer events rather than mouse events, so a finger works the same as a
// cursor — and several fingers can hold several notes at once.
const held = new Map()   // pointerId -> midi

function startNote (id, midi) {
  if (midi == null || !$('soundChk').checked) return
  if ($('sustainChk').checked) {
    synth.isOn(midi) ? synth.noteOff(midi) : synth.noteOn(midi, { a4: engine.state.a4 })
    return
  }
  synth.noteOn(midi, { a4: engine.state.a4 })
  held.set(id, midi)
}

function slideNote (id, midi) {
  const current = held.get(id)
  if (current == null || midi == null || midi === current) return
  synth.noteOff(current)
  held.delete(id)
  startNote(id, midi)
}

function endNote (id) {
  const midi = held.get(id)
  if (midi == null) return
  held.delete(id)
  synth.noteOff(midi)
}

function midiAtPiano (e) {
  const r = $('piano').getBoundingClientRect()
  return pianoKeyAt(view, r.width, r.height, e.clientX - r.left, e.clientY - r.top)
}

function midiAtRail (e) {
  const r = $('rail').getBoundingClientRect()
  return railMidiAt(view, r.height, e.clientY - r.top)
}

for (const [el, resolve] of [[$('piano'), midiAtPiano], [$('rail'), midiAtRail]]) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault()
    // Capture is an optimisation (it keeps the slide alive outside the canvas);
    // if the browser refuses it, the note must still sound.
    try { el.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    startNote(e.pointerId, resolve(e))
  })
  // Sliding across the keys glides from note to note.
  el.addEventListener('pointermove', e => { if (held.has(e.pointerId)) slideNote(e.pointerId, resolve(e)) })
  el.addEventListener('pointerup', e => endNote(e.pointerId))
  el.addEventListener('pointercancel', e => endNote(e.pointerId))
}
window.addEventListener('blur', () => {
  [...held.keys()].forEach(endNote)
  if (!$('sustainChk').checked) synth.allOff()
})

// ------------------------------------------------------------ interactions --
const tl = $('timeline')
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

tl.addEventListener('wheel', e => {
  e.preventDefault()
  if (e.shiftKey) {
    view.zoomPitch(e.deltaY > 0 ? 1.12 : 0.89)
    $('autoChk').checked = false
  } else {
    view.timeWindow = clamp(view.timeWindow * (e.deltaY > 0 ? 1.12 : 0.89), 2, 40)
  }
}, { passive: false })

// One pointer scrubs history, two pinch the time window.
const tlPointers = new Map()   // pointerId -> clientX
let dragStartX = null
let dragBase = 0
let pinch = null

const spread = () => {
  const xs = [...tlPointers.values()]
  return xs.length === 2 ? Math.abs(xs[0] - xs[1]) : 0
}

tl.addEventListener('pointerdown', e => {
  try { tl.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
  tlPointers.set(e.pointerId, e.clientX)
  if (tlPointers.size === 2) {
    pinch = { dist: spread(), window: view.timeWindow }
    dragStartX = null
  } else {
    dragStartX = e.clientX
    dragBase = view.scrollBack
  }
})

tl.addEventListener('pointermove', e => {
  if (tlPointers.has(e.pointerId)) tlPointers.set(e.pointerId, e.clientX)

  if (pinch && tlPointers.size === 2) {
    const d = spread()
    if (d > 8) view.timeWindow = clamp(pinch.window * (pinch.dist / d), 2, 40)
    return
  }
  if (dragStartX != null && tlPointers.has(e.pointerId)) {
    const perPx = view.timeWindow / tl.getBoundingClientRect().width
    view.scrollBack = Math.max(0, dragBase + (e.clientX - dragStartX) * perPx)
  }
  view.hoverTime = timeAtX(tl, e.clientX, view, displayNow())
})

function endTimelinePointer (e) {
  const wasTap = dragStartX != null && Math.abs(e.clientX - dragStartX) < 4 && !pinch
  tlPointers.delete(e.pointerId)
  if (tlPointers.size < 2) pinch = null
  if (!tlPointers.size) dragStartX = null

  if (wasTap) {
    // A tap without a drag pins the inspect cursor (tap again to release).
    const t = timeAtX(tl, e.clientX, view, displayNow())
    view.inspectTime = view.inspectTime != null ? null : t
  }
  // A finger leaves no cursor behind, so the hover readout goes with it.
  if (e.pointerType !== 'mouse') {
    view.hoverTime = null
    $('tooltip').classList.remove('show')
  }
}

tl.addEventListener('pointerup', endTimelinePointer)
tl.addEventListener('pointercancel', endTimelinePointer)
tl.addEventListener('pointerleave', e => {
  if (e.pointerType !== 'mouse' || tlPointers.size) return
  view.hoverTime = null
  $('tooltip').classList.remove('show')
})

// ---------------------------------------------------------------- chrome UI --
$('settingsBtn').onclick = () => {
  const open = $('controls').classList.toggle('open')
  $('settingsBtn').setAttribute('aria-expanded', String(open))
}

let toastTimer = 0
function toast (message) {
  const el = $('toast')
  el.textContent = message
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200)
}

const canFullscreen = !!document.documentElement.requestFullscreen
if (!canFullscreen) $('fsBtn').style.display = 'none'   // iPhone Safari has no Fullscreen API

function toggleFullscreen () {
  if (!canFullscreen) return
  if (document.fullscreenElement) { document.exitFullscreen(); return }
  // Some embedded browser views refuse fullscreen outright. Say so rather than
  // leaving a button that appears to do nothing.
  document.querySelector('.app').requestFullscreen()
    .catch(() => toast('This browser view will not allow fullscreen — try the page in a normal browser tab.'))
}
$('fsBtn').onclick = toggleFullscreen
document.addEventListener('fullscreenchange', () => {
  const on = !!document.fullscreenElement
  $('fsBtn').classList.toggle('on', on)
  $('fsBtn').title = on ? 'Exit fullscreen (shift+F)' : 'Fullscreen (shift+F)'
})

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
  if (e.code === 'Space') { e.preventDefault(); engine.running ? stopMic() : startMic() }
  if (e.key === 'r' || e.key === 'R') { engine.clear(); view.scrollBack = 0 }
  if ((e.key === 'f' || e.key === 'F') && !e.shiftKey) $('freezeBtn').click()
  if (e.key === 'Escape') synth.allOff()
  if (e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); toggleFullscreen() }
})

// ----------------------------------------------------------------- exports --
$('csvBtn').onclick = () => {
  const segs = buildSegments(engine.frames)
  const rows = ['start_s,end_s,duration_s,note,swara,swara_punjabi,saptak,midi,cents_off,vibrato_cents,bar,beat']
  for (const s of segs) {
    const beat = transport.beatAt(s.start)
    rows.push([
      s.start.toFixed(3), s.end.toFixed(3), (s.end - s.start).toFixed(3),
      noteName(s.semitone, view.useFlats),
      sargamName(s.semitone, view.saMidi, { script: 'latin' }),
      sargamName(s.semitone, view.saMidi, { script: 'punjabi' }),
      swaraOf(s.semitone, view.saMidi).saptak,
      s.semitone, s.cents.toFixed(1),
      s.vibrato.toFixed(1), Math.floor(beat / transport.state.beatsPerBar) + 1,
      Math.floor(beat % transport.state.beatsPerBar) + 1
    ].join(','))
  }
  download(new Blob([rows.join('\n')], { type: 'text/csv' }), 'pitch-session.csv')
}

$('pngBtn').onclick = () => {
  const rail = $('rail')
  const lane = $('beatlane')
  const out = document.createElement('canvas')
  out.width = rail.width + tl.width
  out.height = tl.height + lane.height
  const c = out.getContext('2d')
  c.fillStyle = '#0c1017'
  c.fillRect(0, 0, out.width, out.height)
  c.drawImage(rail, 0, 0)
  c.drawImage(tl, rail.width, 0)
  c.drawImage(lane, rail.width, tl.height)
  out.toBlob(b => download(b, 'pitch-graph.png'))
}

function download (blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// -------------------------------------------------------------- render loop --
function displayNow () {
  return view.frozen ? frozenNow : engine.now
}

function frameNear (t) {
  const frames = engine.frames
  if (!frames.length) return null
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (frames[mid].t < t) lo = mid + 1
    else hi = mid
  }
  return frames[lo]
}

function render () {
  requestAnimationFrame(render)
  const now = displayNow()
  view.ease()

  const frames = engine.frames

  // Auto-range from the last 20 s of voiced material.
  if (view.autoRange && frames.length) {
    let min = Infinity
    let max = -Infinity
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i]
      if (now - f.t > 20) break
      if (f.midi > 0) { if (f.midi < min) min = f.midi; if (f.midi > max) max = f.midi }
    }
    view.fitTo(min, max)
  }

  // Which key is lit, and what recently faded.
  const recent = new Map()
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]
    const age = now - f.t
    if (age > 2.5) break
    if (f.midi <= 0) continue
    const m = Math.round(f.midi)
    if (!recent.has(m) || recent.get(m) > age) recent.set(m, age)
  }

  const live = engine.running && !view.frozen && view.inspectTime == null
  const cursorFrame = view.inspectTime != null ? frameNear(view.inspectTime) : frames[frames.length - 1]
  if (cursorFrame && cursorFrame.midi > 0) lastVoiced = cursorFrame
  const shown = cursorFrame && cursorFrame.midi > 0 ? cursorFrame
    : (lastVoiced && now - lastVoiced.t < 1.2 ? lastVoiced : null)
  const activeMidi = shown ? Math.round(shown.midi) : null
  const cents = shown ? centsOff(shown.midi) : null

  const playing = synth.playing()
  const { segs } = drawTimeline(tl, { view, frames, transport, now })
  drawKeyRail($('rail'), { view, active: activeMidi, recent, playing })
  drawBeatLane($('beatlane'), { view, transport, segs, now })
  drawPiano($('piano'), { view, active: activeMidi, recent, cents, playing })
  drawMeter($('meter'), { cents, live: shown != null })

  // ---- readout ----
  if (shown) {
    const west = noteName(shown.midi, view.useFlats)
    const swaraPunjabi = sargamName(shown.midi, view.saMidi, { script: 'punjabi' })
    const swaraLatin = sargamName(shown.midi, view.saMidi, { script: 'latin' })
    // Whichever system is selected leads; the other is always shown beneath it,
    // so the western note and the swara are never more than a glance apart.
    const lead = view.labelMode === 'west' ? west
      : view.labelMode === 'sargam' ? swaraLatin
        : swaraPunjabi
    const alt = view.labelMode === 'west'
      ? `${swaraLatin} · ${swaraPunjabi}`
      : view.labelMode === 'sargam' ? `${west} · ${swaraPunjabi}`
        : `${west} · ${swaraLatin}`
    $('noteBig').textContent = lead
    $('altBig').textContent = alt
    $('saptakTxt').textContent = SAPTAK_NAMES[swaraOf(shown.midi, view.saMidi).saptak] || '—'
    $('noteBig').style.color = tuningColor(cents, 1)
    const dir = cents > 0 ? 'sharp' : 'flat'
    $('centsTxt').textContent = Math.abs(cents) < 5
      ? 'in tune'
      : `${cents > 0 ? '+' : ''}${cents.toFixed(0)}¢ ${dir}`
    $('hzTxt').textContent = midiToFreq(shown.midi, engine.state.a4).toFixed(1) + ' Hz'
    $('targetTxt').textContent = midiToFreq(Math.round(shown.midi), engine.state.a4).toFixed(1) + ' Hz'
    $('confTxt').textContent = (shown.clarity * 100).toFixed(0) + '%'
  } else {
    $('noteBig').textContent = '—'
    $('altBig').innerHTML = '&nbsp;'
    $('saptakTxt').textContent = '—'
    $('noteBig').style.color = ''
    $('centsTxt').textContent = engine.running ? 'listening…' : 'stopped'
    $('hzTxt').textContent = '— Hz'
    $('targetTxt').textContent = '—'
    $('confTxt').textContent = '—'
  }

  const beat = transport.beatAt(now)
  $('posTxt').textContent =
    `bar ${Math.floor(beat / transport.state.beatsPerBar) + 1} · beat ${Math.floor(beat % transport.state.beatsPerBar) + 1}`

  // ---- recent-note list (rebuilt only when the segment run changes) ----
  if (segs.length !== historySig) {
    historySig = segs.length
    const list = $('history')
    list.innerHTML = ''
    for (const s of segs.slice(-9).reverse()) {
      const li = document.createElement('li')
      const off = Math.abs(s.cents) < 5 ? '✓' : `${s.cents > 0 ? '+' : ''}${s.cents.toFixed(0)}¢`
      li.innerHTML = `<span>${labelFor(s.semitone, view)}</span>
        <span style="color:${tuningColor(s.cents, 1)}">${off}</span>
        <span style="color:var(--dim)">${(s.end - s.start).toFixed(2)}s</span>`
      list.appendChild(li)
    }
  }

  // ---- hover tooltip ----
  const tip = $('tooltip')
  if (view.hoverTime != null && frames.length) {
    const f = frameNear(view.hoverTime)
    if (f) {
      const b = transport.beatAt(f.t)
      const rect = tl.getBoundingClientRect()
      const x = ((f.t - view.viewStart(now)) / view.timeWindow) * rect.width
      tip.style.left = x + 'px'
      tip.style.top = '46px'
      tip.textContent = f.midi > 0
        ? `${dualLabel(f.midi, view)}
${centsOff(f.midi) > 0 ? '+' : ''}${centsOff(f.midi).toFixed(0)}¢
${midiToFreq(f.midi, engine.state.a4).toFixed(1)} Hz
${f.t.toFixed(2)}s · bar ${Math.floor(b / transport.state.beatsPerBar) + 1} beat ${Math.floor(b % transport.state.beatsPerBar) + 1}`
        : `silence\n${f.t.toFixed(2)}s`
      tip.classList.add('show')
    }
  } else {
    tip.classList.remove('show')
  }
}

// Canvas ignores webfonts that have not been loaded yet, so ask for them up
// front and redraw once they land.
Promise.all([
  document.fonts.load('400 12px "Noto Sans Gurmukhi"'),
  document.fonts.load('700 56px "Noto Sans Gurmukhi"')
]).catch(() => {})

refreshDevices()
render()

// ?demo runs the app against a synthesised voice — handy for checking the
// display without singing, and for verifying the detector end to end.
if (new URLSearchParams(location.search).has('demo')) {
  import('./audio/demo.js').then(({ attachDemoSource }) => {
    const go = async () => {
      await engine.startDemo((ctx, analyser, opts) =>
        attachDemoSource(ctx, analyser, { bpm: transport.state.bpm, ...opts }))
      $('gate').classList.add('hidden')
      $('recBtn').classList.add('on')
      $('recBtn').textContent = '\u25a0 Stop'
    }
    $('gateBtn').onclick = go
    go().catch(() => { /* needs a click first if autoplay is blocked */ })
  })
}

// Exposed for debugging from the console (and for feeding synthetic frames).
window.pitchscope = { engine, view, transport, synth }
