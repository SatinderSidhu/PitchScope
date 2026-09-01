// Test fixture: a synthesised "voice" wired straight into the analyser, so the
// whole detection chain can be exercised without a microphone. Enable with
// ?demo in the URL. Silent — it never connects to the speakers.

const MELODY = [60, 62, 64, 62, 67, 67, 65, 64, 62, 60, 60, 64, 67, 71, 69, 67]

export function attachDemoSource (ctx, analyser, { bpm = 80, a4 = 440 } = {}) {
  const osc = ctx.createOscillator()
  // A few harmonics with a weak fundamental — the case that fools naive FFT
  // peak-picking into reporting an octave too high.
  osc.setPeriodicWave(ctx.createPeriodicWave(
    new Float32Array([0, 0.35, 1, 0.8, 0.5, 0.3, 0.2, 0.1]),
    new Float32Array(8)
  ))

  const vibrato = ctx.createOscillator()
  const vibratoGain = ctx.createGain()
  vibrato.frequency.value = 5.5
  vibratoGain.gain.value = 0     // in cents, set per note below
  vibrato.connect(vibratoGain).connect(osc.detune)

  const gain = ctx.createGain()
  gain.gain.value = 0
  osc.connect(gain).connect(analyser)

  // An analyser is only processed if something downstream pulls it, so route it
  // to the destination through a silent gain.
  const mute = ctx.createGain()
  mute.gain.value = 0
  analyser.connect(mute).connect(ctx.destination)

  const beat = 60 / bpm
  const t0 = ctx.currentTime + 0.1
  MELODY.forEach((midi, i) => {
    const start = t0 + i * beat
    const freq = a4 * Math.pow(2, (midi - 69) / 12)
    const detuneCents = ((i * 37) % 11) - 5      // a believable per-note error
    osc.frequency.setValueAtTime(freq, start)
    osc.detune.setValueAtTime(detuneCents, start)
    vibratoGain.gain.setValueAtTime(0, start)
    vibratoGain.gain.linearRampToValueAtTime(22, start + beat * 0.4)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.5, start + 0.03)
    gain.gain.setValueAtTime(0.5, start + beat * 0.78)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + beat * 0.9)
  })

  osc.start(t0)
  vibrato.start(t0)
  osc.stop(t0 + MELODY.length * beat + 0.2)
  vibrato.stop(t0 + MELODY.length * beat + 0.2)
  return { osc, gain }
}
