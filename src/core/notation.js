// Turning a sung phrase into notation a musician can read and play.
//
// The analysis gives held notes at whatever moment they happened; a player
// needs them on a beat grid. Everything here is that conversion: snap onsets
// and lengths to a subdivision of the beat, lay them into bars of the chosen
// taal, and emit either a sargam sheet or a MIDI file.

import { noteName, midiToFreq } from './notes.js'
import { sargamName } from './sargam.js'

// A slot must be mostly covered by a note before it counts as that note;
// otherwise a passing scoop into the next swara would claim a whole beat.
const SLOT_COVERAGE = 0.42

export function quantize (segs, { bpm, division = 2 }) {
  if (!segs.length) return { events: [], slotSeconds: 0, division }
  const slotSeconds = (60 / bpm) / division
  const firstSlot = Math.floor(segs[0].start / slotSeconds)
  const lastSlot = Math.ceil(segs[segs.length - 1].end / slotSeconds)

  // Which note, if any, owns each slot.
  const owner = []
  for (let i = firstSlot; i < lastSlot; i++) {
    const t0 = i * slotSeconds
    const t1 = t0 + slotSeconds
    let best = null
    let bestOverlap = 0
    for (const s of segs) {
      if (s.end <= t0) continue
      if (s.start >= t1) break
      const overlap = Math.min(s.end, t1) - Math.max(s.start, t0)
      if (overlap > bestOverlap) { bestOverlap = overlap; best = s }
    }
    owner.push(best && bestOverlap >= slotSeconds * SLOT_COVERAGE ? best.semitone : null)
  }

  // Runs of the same pitch become one note; runs of nothing become rests.
  const events = []
  for (let i = 0; i < owner.length; i++) {
    const semitone = owner[i]
    let length = 1
    while (i + length < owner.length && owner[i + length] === semitone) length++
    events.push({ semitone, slots: length, startSlot: firstSlot + i })
    i += length - 1
  }

  // A phrase should start on its first note, not on the silence before it.
  while (events.length && events[0].semitone == null) events.shift()
  while (events.length && events[events.length - 1].semitone == null) events.pop()

  return { events, slotSeconds, division, startSlot: events.length ? events[0].startSlot : 0 }
}

// Lay the events into bars, one cell per slot, so a sheet can be drawn or
// printed directly from it.
export function buildSheet (quantized, { beatsPerBar, division }) {
  const slotsPerBar = beatsPerBar * division
  const cells = []
  for (const e of quantized.events) {
    for (let i = 0; i < e.slots; i++) {
      cells.push({
        semitone: e.semitone,
        held: i > 0,                       // a continuation of the note before it
        rest: e.semitone == null
      })
    }
  }
  const bars = []
  for (let i = 0; i < cells.length; i += slotsPerBar) {
    bars.push(cells.slice(i, i + slotsPerBar))
  }
  // Pad the final bar so the grid stays rectangular.
  const last = bars[bars.length - 1]
  if (last) while (last.length < slotsPerBar) last.push({ semitone: null, rest: true, pad: true })
  return { bars, slotsPerBar, division, beatsPerBar }
}

export function cellText (cell, view) {
  // Rest first: a rest that spans several slots is still a rest, and printing
  // the hold mark there would read as "hold the previous swara".
  if (cell.rest) return cell.pad ? '' : '·'    // middle dot: a rest
  if (cell.held) return '–'                    // en dash: hold the previous swara
  return view.labelMode === 'west'
    ? noteName(cell.semitone, view.useFlats)
    : sargamName(cell.semitone, view.saMidi, { script: view.script })
}

// A monospace rendering, for pasting into a message or printing out.
export function toText (sheet, view, header) {
  const lines = [...header, '']
  const width = sheet.division > 1 ? 5 : 6
  sheet.bars.forEach((bar, i) => {
    const cells = bar.map(c => {
      const text = cellText(c, view) || ' '
      return text.padEnd(width, ' ')
    })
    // Group the cells of each beat together, so the beat structure is visible.
    const beats = []
    for (let b = 0; b < cells.length; b += sheet.division) {
      beats.push(cells.slice(b, b + sheet.division).join(''))
    }
    lines.push(`${String(i + 1).padStart(3)} | ${beats.join('| ')}|`)
  })
  return lines.join('\n')
}

// ------------------------------------------------------------------- MIDI --
// A standard format-0 file: any notation app, DAW or keyboard will open it.

function variableLength (value) {
  const bytes = [value & 0x7f]
  value >>= 7
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80)
    value >>= 7
  }
  return bytes
}

function text (str) {
  return [...str].map(c => c.charCodeAt(0) & 0x7f)
}

export function toMidi (quantized, { bpm, beatsPerBar, division, name = 'PitchScope take' }) {
  const PPQ = 480
  const ticksPerSlot = Math.round(PPQ / division)
  const track = []

  track.push(0x00, 0xff, 0x03, ...variableLength(name.length), ...text(name))

  const usPerQuarter = Math.round(60000000 / bpm)
  track.push(0x00, 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff)

  // Denominator is quarter notes (2 = 2^2), which matches a tempo given as a
  // quarter-note pulse.
  track.push(0x00, 0xff, 0x58, 0x04, beatsPerBar, 0x02, 24, 8)

  let pending = 0     // ticks of rest waiting to be charged to the next event
  for (const e of quantized.events) {
    const ticks = e.slots * ticksPerSlot
    if (e.semitone == null) { pending += ticks; continue }
    track.push(...variableLength(pending), 0x90, e.semitone & 0x7f, 90)
    track.push(...variableLength(ticks), 0x80, e.semitone & 0x7f, 0x40)
    pending = 0
  }
  track.push(0x00, 0xff, 0x2f, 0x00)      // end of track

  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    0, 0,                                  // format 0
    0, 1,                                  // one track
    (PPQ >> 8) & 0xff, PPQ & 0xff
  ]
  const length = track.length
  const trackHeader = [0x4d, 0x54, 0x72, 0x6b,
    (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]

  return new Uint8Array([...header, ...trackHeader, ...track])
}

// The context a musician needs before the notes mean anything.
export function sheetHeader ({ view, engine, transport, source, noteCount }) {
  const sa = noteName(view.saMidi)
  const saHz = midiToFreq(view.saMidi, engine.state.a4).toFixed(1)
  return [
    `${source} — ${noteCount} notes`,
    `Sa = ${sa} (${saHz} Hz, A4 = ${engine.state.a4})`,
    `Taal ${transport.state.beatsPerBar}/4 at ${transport.state.bpm} bpm`,
    `Each bar is one line; – holds the previous note, · is a rest`
  ]
}
