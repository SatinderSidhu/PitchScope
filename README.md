# PitchScope

A real-time vocal pitch visualiser for singers, in the browser. Sing, and see
the note you are on, how far off it is in cents, what you sang before, and where
each note landed on the beat grid.

Built for practising against an Indian-classical frame as well as a western one:
notes can be labelled in Gurmukhi sargam (ਸਾ ਰੇ ਗਾ ਮਾ ਪਾ ਧਾ ਨੀ), roman sargam,
western names, or both at once, with a Sa you choose.

**Live:** https://satindersidhu.github.io/PitchScope/

## Features

- **Pitch timeline** — a scrolling piano-roll of quantised note blocks with the
  true pitch curve drawn on top, so scoops, drift and vibrato are visible inside
  the note
- **Cents meter** — ±50¢ tuning readout, green when centred
- **Two keyboards** — a vertical rail that doubles as the graph's Y axis, and a
  horizontal piano; the key you are singing lights up, recent keys fade out
- **Playable keys** — click any key on either keyboard to hear a reed-like
  reference tone, drag to glide between notes, or turn on *sustain* to latch
  notes so a Sa + Pa drone keeps ringing while you sing (Esc stops everything).
  Wear headphones, or the microphone will hear the tone as well as your voice
- **Beat grid** — vertical bar/beat lines through the graph plus a per-beat lane
  showing which note occupied each beat. 4/4 by default, also 3/4, 2/4, 5/4,
  6/8, 7/8, with an optional metronome
- **Sargam** — configurable Sa (B2 by default), all twelve swaras with komal and
  teevra, saptak markers, and the ten thaats for scale highlighting
- **Fullscreen** — a toggle in the bar, or shift+F
- **Works on a phone** — the layout collapses to a single column with the
  controls behind a Setup button, and every gesture is touch-native: tap or
  slide the keys (several fingers at once), drag the graph to scrub back
  through history, pinch it to zoom the time window
- **Note history** — a scrollable list of every note sung this session with its
  tuning error, a ±50¢ deviation bar and how far the pitch wandered while held
- **Accuracy by note** — the same data averaged per note and sorted worst first,
  so a habit ("my Ga is always 25¢ flat") shows up as a habit rather than as one
  bad attempt
- **Settings are remembered** — Sa, scale, labelling, tempo, meter, reference
  pitch and volume are stored in the browser and restored on the next visit
- **Export** — the graph as PNG, or the session as CSV (note, swara, saptak,
  cents, vibrato, bar and beat per sung note)

Audio is analysed entirely in the browser with the Web Audio API. Nothing is
uploaded or recorded to disk.

## Running locally

```bash
npm install
npm run dev
```

Then open the printed `localhost` URL and allow microphone access. Append
`?demo` to the URL to drive the whole pipeline from a synthesised voice instead
of a microphone — useful for checking the display without singing.

## How pitch detection works

The microphone is analysed with the **McLeod Pitch Method** (a normalised square
difference function with key-maxima picking) rather than FFT peak-picking, since
a sung vowel often has a weak or missing fundamental that makes spectral peaks
land an octave too high. A running median over the last few frames removes the
isolated octave flips that survive, and a clarity gate suppresses breath noise.

## Licence

MIT
