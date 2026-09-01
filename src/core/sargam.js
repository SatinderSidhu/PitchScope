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

// Devanagari, as Hindi notation writes it.
export const SWARA_HINDI = [
  'सा',
  KOMAL + 'रे', 'रे',
  KOMAL + 'गा', 'गा',
  'मा', TEEVRA + 'मा',
  'पा',
  KOMAL + 'धा', 'धा',
  KOMAL + 'नी', 'नी'
]

// Urdu. Written in the Arabic script, which is right-to-left; the flat and
// sharp signs are neutral characters and stay on the left of the word.
export const SWARA_URDU = [
  'سا',
  KOMAL + 'رے', 'رے',
  KOMAL + 'گا', 'گا',
  'ما', TEEVRA + 'ما',
  'پا',
  KOMAL + 'دھا', 'دھا',
  KOMAL + 'نی', 'نی'
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

const TABLES = {
  latin: SWARA_LATIN,
  punjabi: SWARA_PUNJABI,
  hindi: SWARA_HINDI,
  urdu: SWARA_URDU
}

export const SCRIPT_NAMES = {
  latin: 'Roman',
  punjabi: 'ਪੰਜਾਬੀ',
  hindi: 'हिंदी',
  urdu: 'اردو'
}

export function sargamName (midi, saMidi, { script = 'latin', short = false } = {}) {
  const { degree, saptak } = swaraOf(midi, saMidi)
  // The Indic and Urdu spellings are already two or three characters, so the
  // short forms only exist for the roman transliteration.
  const table = short && script === 'latin' ? SWARA_SHORT : (TABLES[script] || SWARA_LATIN)
  return saptakMark(table[degree], saptak)
}

// Saptak (register) names, in each script the app can label with.
const SAPTAK_TABLE = {
  latin:   { '-2': 'ati-mandra', '-1': 'mandra', 0: 'madhya', 1: 'taar', 2: 'ati-taar' },
  punjabi: { '-2': 'ਅਤਿ-ਮੰਦਰ', '-1': 'ਮੰਦਰ', 0: 'ਮੱਧ', 1: 'ਤਾਰ', 2: 'ਅਤਿ-ਤਾਰ' },
  hindi:   { '-2': 'अति-मंद्र', '-1': 'मंद्र', 0: 'मध्य', 1: 'तार', 2: 'अति-तार' },
  urdu:    { '-2': 'اتی مندر', '-1': 'مندر', 0: 'مدھ', 1: 'تار', 2: 'اتی تار' }
}

export function saptakName (saptak, script = 'latin') {
  const latin = SAPTAK_TABLE.latin[saptak]
  if (!latin) return '—'
  if (script === 'latin' || !SAPTAK_TABLE[script]) return latin
  return `${latin} ${SAPTAK_TABLE[script][saptak]}`
}

export function isSa (midi, saMidi) {
  return swaraOf(midi, saMidi).degree === 0
}

// The label the UI should print for a note.
// view.labelMode: 'west' | 'sargam' | 'both'   view.script: which sargam script
export function labelFor (midi, view, { short = false } = {}) {
  const west = noteName(midi, view.useFlats)
  switch (view.labelMode) {
    case 'sargam': return sargamName(midi, view.saMidi, { script: view.script, short })
    case 'both':   return west + ' ' + sargamName(midi, view.saMidi, { script: view.script, short: true })
    default:       return west
  }
}

// Labels for a note from most to least informative, so a caller with limited
// width can pick the first one that fits rather than overflowing its box.
export function labelCandidates (midi, view) {
  const west = noteName(midi, view.useFlats)
  if (view.labelMode === 'west') return [west]
  const swara = sargamName(midi, view.saMidi, { script: view.script })
  const short = sargamName(midi, view.saMidi, { script: 'latin', short: true })
  if (view.labelMode === 'both') return [west + ' ' + swara, swara, west, short]
  return [swara, short, west]
}

// Both systems spelled out, for the readout and the tooltip.
export function dualLabel (midi, view) {
  const west = noteName(midi, view.useFlats)
  const latin = sargamName(midi, view.saMidi, { script: 'latin' })
  if (view.script === 'latin') return `${west} · ${latin}`
  const native = sargamName(midi, view.saMidi, { script: view.script })
  return `${west} · ${latin} · ${native}`
}
