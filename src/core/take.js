// Encoding a recorded take. The raw analysis is one object per animation frame,
// which is far too bulky to keep; it is resampled onto a fixed grid and packed
// into typed arrays instead. At 50Hz a five-minute take is 15,000 samples —
// about 45KB — small enough that dozens of takes cost less than one minute of
// audio.

export const TRACK_RATE = 50   // samples per second
const MAX_HOLD = 0.25          // seconds a single frame may cover before it becomes a gap

// midi is stored as hundredths of a semitone; 0 marks silence, which is
// unambiguous because sung pitch never approaches MIDI 0.
export function encodeTrack (frames, duration) {
  const n = Math.max(1, Math.ceil(duration * TRACK_RATE))
  const midi = new Int16Array(n)
  const clarity = new Uint8Array(n)

  // Each voiced frame is held until the next one, the way the live renderer
  // joins consecutive frames. Sampling the nearest frame instead would punch
  // holes in the track whenever capture ran slower than the grid — which is
  // exactly what happens if the browser throttles the tab mid-take.
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (f.midi <= 0) continue                  // silence stays silence
    const next = frames[i + 1]
    const until = Math.min(
      next ? next.t : f.t + 1 / TRACK_RATE,
      f.t + MAX_HOLD                            // never invent more than this
    )
    const value = Math.round(f.midi * 100)
    const conf = Math.round(Math.min(1, f.clarity) * 255)
    for (let s = Math.max(0, Math.ceil(f.t * TRACK_RATE)); s < n && s / TRACK_RATE < until; s++) {
      midi[s] = value
      clarity[s] = conf
    }
  }
  return { midi, clarity, rate: TRACK_RATE }
}

// Back into the frame shape the renderers already understand.
export function decodeTrack (track) {
  const rate = track.rate || TRACK_RATE
  const frames = new Array(track.midi.length)
  for (let s = 0; s < track.midi.length; s++) {
    frames[s] = {
      t: s / rate,
      midi: track.midi[s] ? track.midi[s] / 100 : 0,
      clarity: track.clarity[s] / 255,
      rms: track.midi[s] ? 0.05 : 0
    }
  }
  return frames
}

// The settings a take was sung under, so a replay looks exactly as it did live.
export function snapshotSettings (view, engine, transport) {
  return {
    saMidi: view.saMidi,
    labelMode: view.labelMode,
    script: view.script,
    useFlats: view.useFlats,
    scaleDegrees: view.scaleDegrees,
    a4: engine.state.a4,
    bpm: transport.state.bpm,
    beatsPerBar: transport.state.beatsPerBar
  }
}

export function applySettings (settings, view, engine, transport) {
  if (!settings) return
  view.setSa(settings.saMidi ?? view.saMidi)
  view.labelMode = settings.labelMode ?? view.labelMode
  view.script = settings.script ?? view.script
  view.useFlats = settings.useFlats ?? view.useFlats
  view.scaleDegrees = settings.scaleDegrees ?? null
  engine.setA4(settings.a4 ?? engine.state.a4)
  transport.state.bpm = settings.bpm ?? transport.state.bpm
  transport.state.beatsPerBar = settings.beatsPerBar ?? transport.state.beatsPerBar
}

export function formatTime (seconds) {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function defaultName (date = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `Take ${pad(date.getHours())}:${pad(date.getMinutes())} · ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`
}
