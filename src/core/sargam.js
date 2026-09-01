// Sargam (Indian solfège) layer. Everything is relative to Sa, which the singer
// picks — B2 by default. The twelve swaras of a saptak, in order from Sa:
// Sa, komal Re, Re, komal Ga, Ga, shuddha Ma, teevra Ma, Pa, komal Dha, Dha,
// komal Ni, Ni.

import { noteName } from './notes.js'

// Komal / teevra are marked with the flat and sharp signs rather than the
// traditional underline and tick. Those are combining marks, and a combining
// mark forces the text run to split across fonts when the base glyph and the
// mark live in different faces — which renders as tofu. Spacing symbols draw
// correctly everywhere and stay legible down to 9px.
const KOMAL = '♭'
const TEEVRA = '♯'

export const SWARA_LATIN = [
  'Sa', KOMAL + 'Re', 'Re', KOMAL + 'Ga', 'Ga',
  'Ma', TEEVRA + 'Ma', 'Pa', KOMAL + 'Dha', 'Dha', KOMAL + 'Ni', 'Ni'
]

export const SWARA_PUNJABI = [
  'ਸਾ',
  KOMAL + 'ਰੇ', 'ਰੇ',
  KOMAL + 'ਗਾ', 'ਗਾ',
  'ਮਾ', TEEVRA + 'ਮਾ',
  'ਪਾ',
  KOMAL + 'ਧਾ', 'ਧਾ',
  KOMAL + 'ਨੀ', 'ਨੀ'
]

// Short forms for tight spaces (timeline blocks, narrow keys).
export const SWARA_SHORT = [
  'S', KOMAL + 'R', 'R', KOMAL + 'G', 'G',
  'M', TEEVRA + 'M', 'P', KOMAL + 'D', 'D', KOMAL + 'N', 'N'
]

// Saptak markers, in the usual typed convention: a trailing dot for mandra
// (below Sa), a trailing apostrophe for taar (above).
const MANDRA = '.'
const TAAR = "'"

// The ten thaats, as semitone offsets from Sa.
export const THAATS = {
  bilawal:  [0, 2, 4, 5, 7, 9, 11],
  khamaj:   [0, 2, 4, 5, 7, 9, 10],
  kafi:     [0, 2, 3, 5, 7, 9, 10],
  asavari:  [0, 2, 3, 5, 7, 8, 10],
  bhairavi: [0, 1, 3, 5, 7, 8, 10],
  bhairav:  [0, 1, 4, 5, 7, 8, 11],
  kalyan:   [0, 2, 4, 6, 7, 9, 11],
  marwa:    [0, 1, 4, 6, 7, 9, 11],
  poorvi:   [0, 1, 4, 6, 7, 8, 11],
  todi:     [0, 1, 3, 6, 7, 8, 11]
}

export const THAAT_PUNJABI = {
  bilawal: 'ਬਿਲਾਵਲ', khamaj: 'ਖਮਾਜ', kafi: 'ਕਾਫੀ', asavari: 'ਆਸਾਵਰੀ',
  bhairavi: 'ਭੈਰਵੀ', bhairav: 'ਭੈਰਵ', kalyan: 'ਕਲਿਆਣ', marwa: 'ਮਾਰਵਾ',
  poorvi: 'ਪੂਰਵੀ', todi: 'ਤੋੜੀ'
}

// Which swara of which saptak a given MIDI note is, relative to Sa.
export function swaraOf (midi, saMidi) {
  const steps = Math.round(midi) - Math.round(saMidi)
  return {
    degree: ((steps % 12) + 12) % 12,
    saptak: Math.floor(steps / 12)   // 0 = madhya, -1 = mandra, +1 = taar
  }
}

function saptakMark (text, saptak) {
  if (saptak === 0) return text
  const mark = saptak < 0 ? MANDRA : TAAR
  return text + mark.repeat(Math.min(2, Math.abs(saptak)))
}

export function sargamName (midi, saMidi, { script = 'latin', short = false } = {}) {
  const { degree, saptak } = swaraOf(midi, saMidi)
  const table = script === 'punjabi' ? SWARA_PUNJABI : (short ? SWARA_SHORT : SWARA_LATIN)
  return saptakMark(table[degree], saptak)
}

export function isSa (midi, saMidi) {
  return swaraOf(midi, saMidi).degree === 0
}

// The label the UI should print for a note, honouring the chosen naming mode.
// mode: 'west' | 'sargam' | 'punjabi' | 'both'
export function labelFor (midi, view, { short = false } = {}) {
  const west = noteName(midi, view.useFlats)
  switch (view.labelMode) {
    case 'sargam':  return sargamName(midi, view.saMidi, { script: 'latin', short })
    case 'punjabi': return sargamName(midi, view.saMidi, { script: 'punjabi' })
    case 'both':    return west + ' ' + sargamName(midi, view.saMidi, { script: view.bothScript, short: true })
    default:        return west
  }
}

// Labels for a note from most to least informative, so a caller with limited
// width can pick the first one that fits rather than overflowing its box.
export function labelCandidates (midi, view) {
  const west = noteName(midi, view.useFlats)
  if (view.labelMode === 'west') return [west]
  const script = view.labelMode === 'punjabi' || view.bothScript === 'punjabi' ? 'punjabi' : 'latin'
  const swara = sargamName(midi, view.saMidi, { script })
  const short = sargamName(midi, view.saMidi, { script: 'latin', short: true })
  if (view.labelMode === 'both') return [west + ' ' + swara, swara, west, short]
  return [swara, short, west]
}

// Both systems spelled out, for the readout and the tooltip.
export function dualLabel (midi, view) {
  const west = noteName(midi, view.useFlats)
  const latin = sargamName(midi, view.saMidi, { script: 'latin' })
  const punjabi = sargamName(midi, view.saMidi, { script: 'punjabi' })
  return `${west} · ${latin} · ${punjabi}`
}
