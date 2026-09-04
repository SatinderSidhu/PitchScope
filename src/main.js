// Gurmukhi is bundled rather than assumed: not every machine has a Gurmukhi
// system face, and canvas text silently falls back to tofu when one is missing.
import '@fontsource/noto-sans-gurmukhi/400.css'
import '@fontsource/noto-sans-gurmukhi/700.css'
import '@fontsource/noto-sans-devanagari/400.css'
import '@fontsource/noto-sans-devanagari/700.css'
import '@fontsource/noto-sans-arabic/400.css'
import '@fontsource/noto-sans-arabic/700.css'

import { createEngine } from './audio/engine.js'
import { createSynth } from './audio/synth.js'
import { loadSettings, saveSettings } from './core/settings.js'
import { createRecorder } from './audio/recorder.js'
import { saveTake, listTakes, loadTake, deleteTake, renameTake, storageUsage } from './core/storage.js'
import { encodeTrack, decodeTrack, snapshotSettings, applySettings, formatTime, defaultName } from './core/take.js'
import { quantize, buildSheet, cellText, toText, toMidi, sheetHeader } from './core/notation.js'
import { createTransport } from './core/transport.js'
import { createView, buildSegments } from './ui/view.js'
import { drawTimeline, timeAtX } from './ui/timeline.js'
import { drawKeyRail, drawPiano, pianoKeyAt, railMidiAt } from './ui/keyboard.js'
import { drawBeatLane } from './ui/beatlane.js'
import { drawMeter } from './ui/meter.js'
import { noteName, centsOff, midiToFreq, tuningColor, SHARP_NAMES, SCALES } from './core/notes.js'
import { labelFor, dualLabel, sargamName, saptakName, swaraOf, THAATS } from './core/sargam.js'

const $ = id => document.getElementById(id)

const view = createView()
const engine = createEngine()
// ensureCtx rather than engine.ctx: the metronome and the keyboard synth both
// need to make sound before the microphone has ever been started.
const transport = createTransport(() => engine.ensureCtx(), () => engine.now)
const synth = createSynth(() => engine.ensureCtx())

let frozenNow = 0
let lastVoiced = null      // most recent confidently voiced frame
let historySig = -1
let historyTick = 0

const stored = loadSettings()
const recorder = createRecorder()

let recording = null   // { startedAt } while a take is being captured
let replay = null      // { meta, frames, audio, url, time, duration, playing } while reviewing one

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


async function refreshDevices () {
  try {
    const devices = await engine.listDevices()
    const sel = $('deviceSel')
    // Keep whatever is already in use selected — re-selecting a different entry
    // here would trigger a device switch, and with it a new permission prompt.
    const keep = engine.currentDeviceId() || sel.value || stored.deviceId
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
    try {
      await engine.start($('deviceSel').value || undefined)
    } catch (err) {
      // A remembered device may no longer be plugged in; fall back to default.
      if (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError') throw err
      engine.release()
      await engine.start(undefined)
    }
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
$('clearBtn').onclick = () => {
  // Clearing restarts the frame clock, which would leave the audio of a take in
  // progress describing a different stretch of time than its pitch track.
  if (recording) { toast('Stop the recording first — clearing mid-take would desync the audio.'); return }
  if (replay) { exitReplay(); return }
  engine.clear()
  view.scrollBack = 0
}
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
// The option value carries both halves: "<mode>:<script>".
$('labelSel').onchange = e => {
  const [mode, script] = e.target.value.split(':')
  view.labelMode = mode
  view.script = script || 'latin'
}
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
  persistSoon()
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
    if (d > 8) { view.timeWindow = clamp(pinch.window * (pinch.dist / d), 2, 40); persistSoon() }
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

// --------------------------------------------------------------- persistence --
// Every control in the setup bar is remembered, so Sa, scale, tempo, labelling
// and volume survive a reload. The metronome is deliberately not restored: it
// would need to start making noise before the page has had a user gesture.
const PERSIST_IDS = [
  'a4', 'saNoteSel', 'saOctSel', 'scaleSel', 'labelSel',
  'bpm', 'meterSel', 'autoChk', 'flatChk', 'soundChk', 'sustainChk', 'vol'
]

function captureSettings () {
  const out = {}
  for (const id of PERSIST_IDS) {
    const el = $(id)
    out[id] = el.type === 'checkbox' ? el.checked : el.value
  }
  out.timeWindow = Math.round(view.timeWindow * 10) / 10
  out.deviceId = engine.currentDeviceId() || $('deviceSel').value || ''
  return out
}

let persistTimer = 0
function persistSoon () {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => saveSettings(captureSettings()), 250)
}

function applyStoredSettings () {
  for (const id of PERSIST_IDS) {
    if (!(id in stored)) continue
    const el = $(id)
    if (el.type === 'checkbox') el.checked = !!stored[id]
    else {
      // Skip anything that is no longer a valid choice (an option we renamed,
      // or a device that has been unplugged).
      if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === String(stored[id]))) continue
      el.value = stored[id]
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  if (Number.isFinite(stored.timeWindow)) view.timeWindow = clamp(stored.timeWindow, 2, 40)
}

$('controls').addEventListener('change', persistSoon)
$('controls').addEventListener('input', persistSoon)

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
  if (e.code === 'Space') {
    e.preventDefault()
    if (replay) toggleReplayPlay()
    else engine.running ? stopMic() : startMic()
  }
  if (e.key === 'r' || e.key === 'R') $('clearBtn').click()
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
  if (replay) return replay.time
  return view.frozen ? frozenNow : engine.now
}

// The frames array is either the live capture or a take being replayed, so
// callers pass it in rather than assuming the live one.
function frameNear (frames, t) {
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
  if (replay) advanceReplay()     // before displayNow, so the readout is never a frame behind
  const now = displayNow()
  view.ease()

  const frames = replay ? replay.frames : engine.frames

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
  // Frames ahead of the playhead are skipped: replaying a take, the rest of the
  // recording is still in the array and would light up every key it ever holds.
  const recent = new Map()
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]
    if (f.t > now) continue
    const age = now - f.t
    if (age > 2.5) break
    if (f.midi <= 0) continue
    const m = Math.round(f.midi)
    if (!recent.has(m) || recent.get(m) > age) recent.set(m, age)
  }

  const live = engine.running && !replay && !view.frozen && view.inspectTime == null
  // Live, the newest frame is the current one. In a replay it is the end of the
  // take, so the frame at the playhead has to be looked up instead.
  const cursorFrame = view.inspectTime != null ? frameNear(frames, view.inspectTime)
    : replay ? frameNear(frames, now)
      : frames[frames.length - 1]
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
    const swaraLatin = sargamName(shown.midi, view.saMidi, { script: 'latin' })
    const swaraNative = sargamName(shown.midi, view.saMidi, { script: view.script })
    // Whichever system is selected leads; the others sit beneath it, so the
    // western note and the swara are never more than a glance apart.
    const lead = view.labelMode === 'west' ? west : swaraNative
    const others = view.labelMode === 'west'
      ? [swaraLatin, view.script === 'latin' ? null : swaraNative]
      : [west, view.script === 'latin' ? null : swaraLatin]
    const alt = others.filter(Boolean).join(' · ')
    $('noteBig').textContent = lead
    $('altBig').textContent = alt
    $('saptakTxt').textContent = saptakName(swaraOf(shown.midi, view.saMidi).saptak, view.script)
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
    $('centsTxt').textContent = replay ? 'silence' : engine.running ? 'listening…' : 'stopped'
    $('hzTxt').textContent = '— Hz'
    $('targetTxt').textContent = '—'
    $('confTxt').textContent = '—'
  }

  const beat = transport.beatAt(now)
  $('posTxt').textContent =
    `bar ${Math.floor(beat / transport.state.beatsPerBar) + 1} · beat ${Math.floor(beat % transport.state.beatsPerBar) + 1}`

  refreshHistory(frames)

  // ---- hover tooltip ----
  const tip = $('tooltip')
  if (view.hoverTime != null && frames.length) {
    const f = frameNear(frames, view.hoverTime)
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
Promise.all(['Noto Sans Gurmukhi', 'Noto Sans Devanagari', 'Noto Sans Arabic'].flatMap(f => [
  document.fonts.load(`400 12px "${f}"`),
  document.fonts.load(`700 56px "${f}"`)
])).catch(() => {})

applyStoredSettings()
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

// ------------------------------------------------------------ recorded takes --
// A take is one continuous capture: pressing Rec clears the graph and starts
// recording, pressing it again ends the take and stores it. Deliberately not
// tied to the Start/Stop pause, because pausing mid-take would leave the audio
// and the pitch track disagreeing about where time went.

async function startRecording () {
  if (replay) exitReplay()
  if (!engine.running) await startMic()
  if (!engine.running) return

  engine.clear()
  view.scrollBack = 0
  view.inspectTime = null

  const wantAudio = $('audioChk')?.checked ?? true
  const gotAudio = wantAudio ? recorder.start(engine.state.stream) : false
  if (wantAudio && !gotAudio) toast('Audio capture is unavailable here — the pitch track will still be saved.')

  recording = { startedAt: Date.now(), audio: gotAudio, warnedHidden: false }
  // Browsers throttle animation frames in a background tab, which stops the
  // pitch analysis even though the audio keeps recording. Say so once.
  document.addEventListener('visibilitychange', warnIfHidden)
  $('recordBtn').classList.add('rec-on')
  $('recordBtn').textContent = '⏹ Stop rec'
}

function warnIfHidden () {
  if (!recording || !document.hidden || recording.warnedHidden) return
  recording.warnedHidden = true
  toast('Keep this tab in front while recording — the pitch track pauses when it is hidden (audio keeps going).')
}

async function stopRecording () {
  if (!recording) return
  document.removeEventListener('visibilitychange', warnIfHidden)
  const { startedAt } = recording
  recording = null
  $('recordBtn').classList.remove('rec-on')
  $('recordBtn').textContent = '⏺ Rec'

  const audio = await recorder.stop()
  const frames = engine.frames.slice()
  const duration = frames.length ? frames[frames.length - 1].t : 0

  if (duration < 1) { toast('Take was too short to keep.'); return }

  const id = 'take-' + startedAt
  const track = encodeTrack(frames, duration)
  const meta = {
    id,
    name: defaultName(new Date(startedAt)),
    startedAt,
    duration,
    hasAudio: !!audio,
    audioBytes: audio ? audio.size : 0,
    settings: snapshotSettings(view, engine, transport)
  }

  try {
    await saveTake({ meta, track, audio })
    toast(`Saved "${meta.name}" — ${formatTime(duration)}`)
    if (!$('takesPanel').hidden) renderTakes()
  } catch (err) {
    // A full disk or a browser refusing storage should say so, not fail quietly.
    toast('Could not save the take: ' + (err?.name || 'storage error'))
  }
}

// Both halves are async, so a throw inside them would otherwise surface only as
// an unhandled rejection — a button that looks alive and does nothing.
$('recordBtn').onclick = () => {
  const action = recording ? stopRecording : startRecording
  action().catch(err => {
    console.error('recording failed', err)
    toast('Recording failed: ' + (err?.message || err))
    recording = null
    $('recordBtn').classList.remove('rec-on')
    $('recordBtn').textContent = '⏺ Rec'
  })
}

// ------------------------------------------------------------------ replay --
async function openTake (id) {
  const take = await loadTake(id)
  if (!take) { toast('That take is no longer stored.'); return }

  if (engine.running) stopMic()
  exitReplay()
  applySettings(take.meta.settings, view, engine, transport)

  const frames = decodeTrack(take.track)
  const url = take.audio ? URL.createObjectURL(take.audio) : null
  const audio = url ? new Audio(url) : null

  replay = {
    meta: take.meta,
    frames,
    audio,
    url,
    time: 0,
    duration: take.meta.duration || (frames.length ? frames[frames.length - 1].t : 0),
    playing: false
  }

  $('gate').classList.add('hidden')
  $('replayBar').hidden = false
  $('replayName').textContent = take.meta.name + (take.audio ? '' : ' (no audio)')
  $('takesPanel').hidden = true
  view.scrollBack = 0
  view.frozen = false
  updateReplayUi()
}

function exitReplay () {
  if (!replay) return
  replay.audio?.pause()
  if (replay.url) URL.revokeObjectURL(replay.url)
  replay = null
  $('replayBar').hidden = true
  historySig = -1        // force the lists back to the live session
}

function toggleReplayPlay () {
  if (!replay) return
  replay.playing = !replay.playing
  if (replay.audio) {
    if (replay.playing) {
      if (replay.time >= replay.duration - 0.05) replay.time = 0
      replay.audio.currentTime = replay.time
      replay.audio.play().catch(() => { replay.playing = false })
    } else replay.audio.pause()
  } else {
    replay.wallClock = performance.now() / 1000 - replay.time
    if (replay.playing && replay.time >= replay.duration - 0.05) {
      replay.time = 0
      replay.wallClock = performance.now() / 1000
    }
  }
  updateReplayUi()
}

// Audio is the clock when there is audio; otherwise the wall clock stands in.
function advanceReplay () {
  if (!replay) return
  if (replay.playing) {
    replay.time = replay.audio
      ? replay.audio.currentTime
      : performance.now() / 1000 - replay.wallClock
    if (replay.time >= replay.duration) {
      replay.time = replay.duration
      replay.playing = false
      replay.audio?.pause()
      updateReplayUi()
    }
  }
  const pos = replay.duration ? (replay.time / replay.duration) * 1000 : 0
  if (document.activeElement !== $('seek')) $('seek').value = String(Math.round(pos))
  $('replayTime').textContent = `${formatTime(replay.time)} / ${formatTime(replay.duration)}`
}

function updateReplayUi () {
  $('playBtn').textContent = replay?.playing ? '❚❚' : '▶'
}

$('playBtn').onclick = toggleReplayPlay
$('exitReplayBtn').onclick = exitReplay
$('seek').oninput = e => {
  if (!replay) return
  replay.time = (Number(e.target.value) / 1000) * replay.duration
  if (replay.audio) replay.audio.currentTime = replay.time
  else replay.wallClock = performance.now() / 1000 - replay.time
}

// -------------------------------------------------------------- takes list --
$('takesBtn').onclick = () => {
  const panel = $('takesPanel')
  panel.hidden = !panel.hidden
  if (!panel.hidden) renderTakes()
}
$('takesCloseBtn').onclick = () => { $('takesPanel').hidden = true }

async function renderTakes () {
  const list = $('takesList')
  let takes = []
  try {
    takes = await listTakes()
  } catch {
    list.innerHTML = '<li class="empty">Storage is unavailable in this browser.</li>'
    return
  }

  if (!takes.length) {
    list.innerHTML = '<li class="empty">No takes yet. Press ⏺ Rec, sing, then press it again.</li>'
  } else {
    list.innerHTML = takes.map(t => `
      <li data-id="${t.id}">
        <span class="t-name" title="Click to rename">${escapeHtml(t.name)}</span>
        <span class="t-actions">
          <button data-act="play">▶ Replay</button>
          <button data-act="rename">Rename</button>
          <button data-act="delete">Delete</button>
        </span>
        <span class="t-meta">${new Date(t.startedAt).toLocaleString()} · ${formatTime(t.duration)}
          · ${t.hasAudio ? (t.audioBytes / 1048576).toFixed(1) + ' MB audio' : 'pitch only'}</span>
      </li>`).join('')
  }

  const { usage, quota } = await storageUsage()
  $('takesUsage').textContent = quota
    ? `${takes.length} take${takes.length === 1 ? '' : 's'} · using ${(usage / 1048576).toFixed(1)} MB of about ${(quota / 1073741824).toFixed(1)} GB available on this device`
    : `${takes.length} take${takes.length === 1 ? '' : 's'} stored in this browser`
}

// Renaming happens in place rather than through a prompt() dialog: browsers
// can suppress those silently, and clicking the title is what people try first.
function beginRename (row, id) {
  const nameEl = row.querySelector('.t-name')
  if (nameEl.querySelector('input')) return
  const current = nameEl.textContent

  nameEl.innerHTML = '<input class="t-rename" maxlength="80" />'
  const input = nameEl.querySelector('input')
  input.value = current
  input.focus()
  input.select()

  let settled = false
  const finish = async keep => {
    if (settled) return              // Enter commits, then blur fires: only act once
    settled = true
    const value = input.value.trim()
    if (keep && value && value !== current) {
      try { await renameTake(id, value) } catch { toast('Could not save that name.') }
    }
    renderTakes()
  }
  input.onkeydown = e => {
    e.stopPropagation()              // keep space/R/F from reaching the app shortcuts
    if (e.key === 'Enter') finish(true)
    if (e.key === 'Escape') finish(false)
  }
  input.onblur = () => finish(true)
}

$('takesList').onclick = async e => {
  const row = e.target.closest('li[data-id]')
  if (!row) return
  const id = row.dataset.id

  if (e.target.closest('.t-name')) return beginRename(row, id)

  const button = e.target.closest('button')
  if (!button) return
  const act = button.dataset.act

  if (act === 'play') return openTake(id)
  if (act === 'rename') return beginRename(row, id)
  if (act === 'delete') {
    if (!confirm('Delete this take permanently?')) return
    if (replay?.meta.id === id) exitReplay()
    await deleteTake(id)
    renderTakes()
  }
}

const escapeHtml = str => str.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// --------------------------------------------------------------- notation --
// What was sung, snapped onto the beat grid and written out as sargam a
// musician can play from — plus a MIDI file for anyone who would rather load it
// into an instrument or notation app.

let sheetState = null    // { sheet, quantized, header, title }

$('notesBtn').onclick = () => {
  const panel = $('notesPanel')
  panel.hidden = !panel.hidden
  if (!panel.hidden) { $('takesPanel').hidden = true; buildNotation() }
}
$('notesCloseBtn').onclick = () => { $('notesPanel').hidden = true }
$('divisionSel').onchange = () => buildNotation()

function buildNotation () {
  // Whatever is on screen: the take being replayed, or the live session.
  const frames = replay ? replay.frames : engine.frames
  const title = replay ? replay.meta.name : 'Live session'
  const segs = buildSegments(frames, { minDur: MIN_HELD })

  const sheetEl = $('sheet')
  if (!segs.length) {
    sheetState = null
    $('sheetHeader').textContent = ''
    sheetEl.innerHTML = '<div class="sheet-empty">Sing a phrase (or open a take) and it will be written out here.</div>'
    return
  }

  const division = Number($('divisionSel').value)
  const quantized = quantize(segs, { bpm: transport.state.bpm, division })
  const sheet = buildSheet(quantized, { beatsPerBar: transport.state.beatsPerBar, division })
  const header = sheetHeader({
    view, engine, transport, source: title,
    noteCount: quantized.events.filter(e => e.semitone != null).length
  })

  sheetState = { sheet, quantized, header, title }
  $('sheetHeader').textContent = header.join('\n')
  renderSheet(sheetEl, sheet)
}

function renderSheet (container, sheet) {
  container.innerHTML = sheet.bars.map((bar, barIndex) => {
    const beats = []
    for (let b = 0; b < bar.length; b += sheet.division) {
      const cells = bar.slice(b, b + sheet.division).map(cell => {
        const text = cellText(cell, view)
        const cls = cell.held ? 'cell held' : cell.rest ? 'cell rest' : 'cell'
        // The western name rides along under each swara, so a musician who
        // reads one system or the other can play from the same sheet.
        const west = !cell.held && !cell.rest && view.labelMode !== 'west'
          ? `<span class="west">${noteName(cell.semitone, view.useFlats)}</span>`
          : ''
        return `<span class="${cls}">${text}${west}</span>`
      }).join('')
      beats.push(`<span class="beat-group${b === 0 ? ' downbeat' : ''}">${cells}</span>`)
    }
    return `<div class="bar-row"><span class="bar-num">${barIndex + 1}</span><span class="bar-beats">${beats.join('')}</span></div>`
  }).join('')
}

$('copyNotesBtn').onclick = async () => {
  if (!sheetState) return
  const text = toText(sheetState.sheet, view, sheetState.header)
  try {
    await navigator.clipboard.writeText(text)
    toast('Notation copied — paste it to your musician.')
  } catch {
    toast('Clipboard is blocked here; use Download .txt instead.')
  }
}

$('txtBtn').onclick = () => {
  if (!sheetState) return
  const text = toText(sheetState.sheet, view, sheetState.header)
  download(new Blob([text], { type: 'text/plain' }), safeFileName(sheetState.title) + '.txt')
}

$('midiBtn').onclick = () => {
  if (!sheetState) return
  const bytes = toMidi(sheetState.quantized, {
    bpm: transport.state.bpm,
    beatsPerBar: transport.state.beatsPerBar,
    division: sheetState.sheet.division,
    name: sheetState.title
  })
  download(new Blob([bytes], { type: 'audio/midi' }), safeFileName(sheetState.title) + '.mid')
}

const safeFileName = str => str.replace(/[^\w\d-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'take'

// ------------------------------------------------------- history & accuracy --
// The lists cover the whole session, not just what is on screen, so a singer
// can scroll back through what they sang and see which notes they habitually
// miss — and in which direction.

const HISTORY_FRAMES = 60 * 60 * 5     // last ~5 minutes
const HISTORY_ROWS = 80
const MIN_HELD = 0.12                  // ignore passing blips between notes

function verdict (cents) {
  if (Math.abs(cents) < 10) return { mark: '✓', text: 'in tune' }
  return cents > 0
    ? { mark: '↑', text: 'sharp' }
    : { mark: '↓', text: 'flat' }
}

const pct = cents => 50 + Math.max(-50, Math.min(50, cents))

// A ±50¢ bar: the translucent band is how far the note wandered while held,
// the solid tick is where it averaged out.
function bar (cents, lo, hi, colour) {
  const left = Math.min(pct(lo), pct(hi))
  const width = Math.max(1.5, Math.abs(pct(hi) - pct(lo)))
  return `<span class="h-bar">
    <span class="spread" style="left:${left}%;width:${width}%;background:${colour}"></span>
    <i style="left:calc(${pct(cents)}% - 1.5px);background:${colour}"></i>
  </span>`
}

function refreshHistory (frames) {
  if (++historyTick % 12) return          // ~5 refreshes a second is plenty
  const recent = frames.length > HISTORY_FRAMES ? frames.slice(-HISTORY_FRAMES) : frames
  const segs = buildSegments(recent, { minDur: MIN_HELD })
  if (segs.length === historySig) return
  historySig = segs.length
  renderRecent(segs)
  renderAccuracy(segs)
}

function renderRecent (segs) {
  const list = $('history')
  if (!segs.length) {
    list.innerHTML = '<li class="empty">Nothing sung yet.</li>'
    return
  }
  list.innerHTML = segs.slice(-HISTORY_ROWS).reverse().map(s => {
    const colour = tuningColor(s.cents, 1)
    const v = verdict(s.cents)
    const lo = (s.min - s.semitone) * 100
    const hi = (s.max - s.semitone) * 100
    const cents = `${s.cents > 0 ? '+' : ''}${s.cents.toFixed(0)}¢`
    return `<li title="${noteName(s.semitone, view.useFlats)} — ${v.text}, wandered ${s.vibrato.toFixed(0)}¢ over ${(s.end - s.start).toFixed(2)}s">
      <span class="h-note">${labelFor(s.semitone, view)}</span>
      ${bar(s.cents, lo, hi, colour)}
      <span class="h-cents" style="color:${colour}">${v.mark} ${cents}</span>
      <span class="h-dur">${(s.end - s.start).toFixed(1)}s</span>
    </li>`
  }).join('')
}

// Which notes does this singer habitually miss? Averaged per pitch, worst first.
function renderAccuracy (segs) {
  const byNote = new Map()
  for (const s of segs) {
    const entry = byNote.get(s.semitone) || { semitone: s.semitone, n: 0, sum: 0, sumAbs: 0 }
    entry.n++
    entry.sum += s.cents
    entry.sumAbs += Math.abs(s.cents)
    byNote.set(s.semitone, entry)
  }

  const rows = [...byNote.values()]
    .filter(e => e.n >= 2)                       // one attempt is not a habit
    .map(e => ({ ...e, mean: e.sum / e.n, meanAbs: e.sumAbs / e.n }))
    .sort((a, b) => b.meanAbs - a.meanAbs)
    .slice(0, 10)

  const list = $('accuracy')
  if (!rows.length) {
    list.innerHTML = '<li class="empty">Sing a note twice or more and it appears here.</li>'
    return
  }
  list.innerHTML = rows.map(e => {
    const colour = tuningColor(e.mean, 1)
    const v = verdict(e.mean)
    return `<li title="Average over ${e.n} attempts — typically ${Math.abs(e.mean).toFixed(0)}¢ ${v.text}">
      <span class="h-note">${labelFor(e.semitone, view)}</span>
      ${bar(e.mean, e.mean, e.mean, colour)}
      <span class="h-cents" style="color:${colour}">${v.mark} ${e.mean > 0 ? '+' : ''}${e.mean.toFixed(0)}¢</span>
      <span class="h-dur">×${e.n}</span>
    </li>`
  }).join('')
}

// Exposed for debugging from the console (and for feeding synthetic frames).
window.pitchscope = { engine, view, transport, synth, get replay () { return replay } }
