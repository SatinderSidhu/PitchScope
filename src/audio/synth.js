// A small polyphonic reference-tone synth for the on-screen keyboards. The
// voice is deliberately reed-like — a harmonium-ish stack of harmonics rather
// than a pure sine — because a tone with overtones is far easier to tune a
// voice against than a bare fundamental.

import { midiToFreq } from '../core/notes.js'

export function createSynth (ensureCtx) {
  const voices = new Map()   // midi -> { osc, osc2, gain }
  let master = null
  let wave = null
  let volume = 0.35

  function setup () {
    const ctx = ensureCtx()
    if (!master) {
      master = ctx.createGain()
      master.gain.value = volume
      master.connect(ctx.destination)
    }
    if (!wave) {
      // Odd harmonics dominate, giving the slightly nasal reed colour.
      wave = ctx.createPeriodicWave(
        new Float32Array([0, 1, 0.55, 0.42, 0.22, 0.16, 0.09, 0.05, 0.03]),
        new Float32Array(9)
      )
    }
    return ctx
  }

  function noteOn (midi, { a4 = 440, velocity = 0.9 } = {}) {
    if (voices.has(midi)) return
    const ctx = setup()
    ctx.resume()

    const freq = midiToFreq(midi, a4)
    const now = ctx.currentTime

    const gain = ctx.createGain()
    // Headroom for chords, and a gentle roll-off so high notes are not shrill.
    const peak = velocity * 0.22 * Math.min(1, 1.4 - (midi - 40) / 90)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(peak * 0.8, now + 0.35)

    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = Math.min(6000, freq * 8)
    tone.Q.value = 0.4

    // Two voices detuned symmetrically about the target. The pair beats gently,
    // the way a real reed or a tanpura string never sits perfectly still, but
    // the detuning cancels out so the reference pitch itself stays exact — a
    // one-sided detune would leave every reference note a couple of cents sharp.
    const osc = ctx.createOscillator()
    osc.setPeriodicWave(wave)
    osc.frequency.value = freq
    osc.detune.value = -3

    const osc2 = ctx.createOscillator()
    osc2.setPeriodicWave(wave)
    osc2.frequency.value = freq
    osc2.detune.value = 3

    osc.connect(tone)
    osc2.connect(tone)
    tone.connect(gain).connect(master)
    osc.start(now)
    osc2.start(now)

    voices.set(midi, { osc, osc2, gain })
  }

  function noteOff (midi) {
    const v = voices.get(midi)
    if (!v) return
    voices.delete(midi)
    const ctx = ensureCtx()
    const now = ctx.currentTime
    const g = v.gain.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(Math.max(0.0001, g.value), now)
    g.exponentialRampToValueAtTime(0.0001, now + 0.18)
    v.osc.stop(now + 0.2)
    v.osc2.stop(now + 0.2)
  }

  return {
    noteOn,
    noteOff,
    allOff () { [...voices.keys()].forEach(noteOff) },
    isOn: midi => voices.has(midi),
    playing: () => new Set(voices.keys()),
    setVolume (v) {
      volume = v
      if (master) master.gain.value = v
    }
  }
}
