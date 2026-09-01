// Tempo grid + metronome. The engine's elapsed time is the master clock, so the
// beat lines on the timeline and the audible click never drift apart.

export function createTransport (getCtx, getNow) {
  const state = {
    bpm: 80,
    beatsPerBar: 4,
    beatUnit: 4,
    clickOn: false,
    nextBeat: 0
  }
  let timer = 0

  function beatDuration () { return 60 / state.bpm }
  function beatAt (time) { return time / beatDuration() }
  function timeOfBeat (beat) { return beat * beatDuration() }

  function schedule () {
    const ctx = getCtx()
    if (!ctx || !state.clickOn) return
    const now = getNow()
    const lookahead = 0.2
    let beat = Math.max(state.nextBeat, Math.ceil(beatAt(now)))
    while (timeOfBeat(beat) < now + lookahead) {
      click(ctx, ctx.currentTime + (timeOfBeat(beat) - now), beat % state.beatsPerBar === 0)
      beat++
    }
    state.nextBeat = beat
  }

  function click (ctx, when, isDownbeat) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = isDownbeat ? 1600 : 1000
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(isDownbeat ? 0.3 : 0.16, when + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05)
    osc.connect(gain).connect(ctx.destination)
    osc.start(when)
    osc.stop(when + 0.06)
  }

  return {
    state,
    beatDuration,
    beatAt,
    timeOfBeat,
    barOfBeat (beat) { return Math.floor(beat / state.beatsPerBar) },
    setClick (on) {
      state.clickOn = on
      state.nextBeat = 0
      clearInterval(timer)
      if (on) timer = setInterval(schedule, 50)
    }
  }
}
