// Encoding a recorded take. The raw analysis is one object per animation frame,
// which is far too bulky to keep; it is resampled onto a fixed grid and packed
// into typed arrays instead. At 50Hz a five-minute take is 15,000 samples —
// about 45KB — small enough that dozens of takes cost less than one minute of
// audio.

export const TRACK_RATE = 50   // samples per second

// midi is stored as hundredths of a semitone; 0 marks silence, which is
// unambiguous because sung pitch never approaches MIDI 0.
export function encodeTrack (frames, duration) {
  const n = Math.max(1, Math.ceil(duration * TRACK_RATE))
  const midi = new Int16Array(n)
  const clarity = new Uint8Array(n)

  let i = 0
  for (let s = 0; s < n; s++) {
    const t = s / TRACK_RATE
    // Advance to the frame nearest this sample time.
    while (i < frames.length - 1 && frames[i + 1].t <= t) i++
    const f = frames[i]
    if (!f || Math.abs(f.t - t) > 0.2 || f.midi <= 0) continue   // gap or silence
    midi[s] = Math.round(f.midi * 100)
    clarity[s] = Math.round(Math.min(1, f.clarity) * 255)
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
