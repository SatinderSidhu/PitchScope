import { createPitchDetector } from './pitch.js'
import { freqToMidi } from '../core/notes.js'

// Owns the microphone, the analyser and the per-frame detection loop.
// Everything downstream just reads `frames`.

const MEDIAN_WINDOW = 5
const MAX_FRAMES = 60 * 60 * 20   // ~20 minutes at 60fps

export function createEngine ({ onFrame } = {}) {
  const state = {
    ctx: null,
    stream: null,
    source: null,
    analyser: null,
    detect: null,
    buffer: null,
    running: false,
    raf: 0,
    a4: 440,
    frames: [],          // { t, midi, clarity, rms }
    startTime: 0,
    lastMidis: []
  }

  // One AudioContext for the whole app: the mic, the metronome and the
  // keyboard synth all share it, and it can exist before the mic is started.
  function ensureCtx () {
    state.ctx = state.ctx || new (window.AudioContext || window.webkitAudioContext)()
    return state.ctx
  }

  async function listDevices () {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter(d => d.kind === 'audioinput')
  }

  // The permission prompt fires per getUserMedia() call, so the stream is
  // acquired once and kept for the whole session. Stopping only pauses the
  // analysis loop and mutes the track; the stream itself stays open, which is
  // what keeps the browser from asking for the mic again mid-session.
  async function start (deviceId) {
    if (state.running) return

    // Any existing stream is reused unconditionally. Re-acquiring is the only
    // thing that can raise a prompt, so it happens exactly once per device the
    // user picks — release() is called explicitly by the device selector.
    const track = state.stream?.getAudioTracks()[0]
    if (track && track.readyState === 'ended') release()   // device went away

    if (state.stream) {
      state.stream.getAudioTracks().forEach(t => { t.enabled = true })
      await state.ctx.resume()
      state.running = true
      if (!state.startTime) state.startTime = state.ctx.currentTime
      loop()
      return
    }
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // The browser's cleanup DSP mangles sustained tones, so it all goes off.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      }
    })

    ensureCtx()
    await state.ctx.resume()

    state.analyser = state.ctx.createAnalyser()
    state.analyser.fftSize = 2048
    state.analyser.smoothingTimeConstant = 0

    state.source = state.ctx.createMediaStreamSource(state.stream)
    state.source.connect(state.analyser)

    state.buffer = new Float32Array(state.analyser.fftSize)
    state.detect = createPitchDetector(state.ctx.sampleRate)
    state.running = true
    if (!state.startTime) state.startTime = state.ctx.currentTime
    loop()
  }

  // Same pipeline as start(), but fed by a synthesised source instead of a mic.
  async function startDemo (attach) {
    if (state.running) stop()
    ensureCtx()
    await state.ctx.resume()
    state.analyser = state.ctx.createAnalyser()
    state.analyser.fftSize = 2048
    state.analyser.smoothingTimeConstant = 0
    state.buffer = new Float32Array(state.analyser.fftSize)
    state.detect = createPitchDetector(state.ctx.sampleRate)
    attach(state.ctx, state.analyser, { a4: state.a4 })
    state.running = true
    state.startTime = state.ctx.currentTime
    loop()
  }

  function currentDeviceId () {
    const track = state.stream?.getAudioTracks()[0]
    return track?.getSettings?.().deviceId
  }

  // Pause: keeps the stream (and therefore the permission) alive.
  function stop () {
    state.running = false
    cancelAnimationFrame(state.raf)
    state.stream?.getAudioTracks().forEach(t => { t.enabled = false })
  }

  // Full teardown — only on an actual device switch or page unload.
  function release () {
    stop()
    if (state.stream) {
      state.stream.getTracks().forEach(t => t.stop())
      state.stream = null
    }
    if (state.source) { state.source.disconnect(); state.source = null }
  }

  function clear () {
    state.frames = []
    state.lastMidis = []
    state.startTime = state.ctx ? state.ctx.currentTime : 0
  }

  // A running median kills the isolated octave flips that survive the detector.
  function smooth (midi) {
    state.lastMidis.push(midi)
    if (state.lastMidis.length > MEDIAN_WINDOW) state.lastMidis.shift()
    const sorted = [...state.lastMidis].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }

  function loop () {
    if (!state.running) return
    state.raf = requestAnimationFrame(loop)

    state.analyser.getFloatTimeDomainData(state.buffer)
    const { freq, clarity, rms } = state.detect(state.buffer)
    const t = state.ctx.currentTime - state.startTime

    let frame
    if (freq > 0) {
      const raw = freqToMidi(freq, state.a4)
      frame = { t, midi: smooth(raw), clarity, rms }
    } else {
      state.lastMidis.length = 0
      frame = { t, midi: 0, clarity, rms }
    }

    state.frames.push(frame)
    if (state.frames.length > MAX_FRAMES) state.frames.shift()
    onFrame?.(frame, state)
  }

  return {
    state,
    ensureCtx,
    start,
    startDemo,
    stop,
    release,
    currentDeviceId,
    clear,
    listDevices,
    get running () { return state.running },
    get frames () { return state.frames },
    get ctx () { return state.ctx },
    get now () { return state.ctx ? state.ctx.currentTime - state.startTime : 0 },
    setA4 (v) { state.a4 = v }
  }
}
