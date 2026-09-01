// Note / frequency helpers. All pitch is carried around as fractional MIDI
// numbers so that cents deviation is just the fractional part.

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

// Semitone offsets from the tonic that belong to a major / natural minor scale.
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
}

export function freqToMidi (freq, a4 = 440) {
  return 69 + 12 * Math.log2(freq / a4)
}

export function midiToFreq (midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12)
}

export function pitchClass (midi) {
  return ((Math.round(midi) % 12) + 12) % 12
}

export function isBlackKey (midi) {
  return [1, 3, 6, 8, 10].includes(pitchClass(midi))
}

export function noteName (midi, useFlats = false) {
  const m = Math.round(midi)
  const names = useFlats ? FLAT_NAMES : SHARP_NAMES
  const octave = Math.floor(m / 12) - 1
  return names[((m % 12) + 12) % 12] + octave
}

// How far the sung pitch sits from the nearest tempered semitone, in cents.
export function centsOff (midiFloat) {
  return (midiFloat - Math.round(midiFloat)) * 100
}

// `degrees` is a list of semitone offsets from the tonic (a western scale or a
// thaat). null means every note belongs.
export function inDegrees (midi, tonic, degrees) {
  if (!degrees) return true
  return degrees.includes((((Math.round(midi) - tonic) % 12) + 12) % 12)
}

// Green when centred, amber when drifting, red when clearly out.
export function tuningColor (cents, alpha = 1) {
  const a = Math.abs(cents)
  let rgb
  if (a <= 12) rgb = '34, 197, 94'
  else if (a <= 30) rgb = '245, 158, 11'
  else rgb = '239, 68, 68'
  return `rgba(${rgb}, ${alpha})`
}
