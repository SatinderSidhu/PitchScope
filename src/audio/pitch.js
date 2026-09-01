// Monophonic pitch detection with the McLeod Pitch Method (NSDF + key-maxima
// picking). Chosen over FFT peak-picking because a sung vowel often has a weak
// or missing fundamental, which makes spectral peaks land an octave too high.

export function createPitchDetector (sampleRate, {
  windowSize = 2048,
  minFreq = 60,       // a shade below C2
  maxFreq = 1300,     // a shade above E6
  clarityThreshold = 0.72,
  rmsThreshold = 0.006
} = {}) {
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq))
  const maxTau = Math.min(windowSize - 2, Math.floor(sampleRate / minFreq))
  const nsdf = new Float32Array(maxTau + 1)

  return function detect (buf) {
    const n = Math.min(buf.length, windowSize)

    let rms = 0
    for (let i = 0; i < n; i++) rms += buf[i] * buf[i]
    rms = Math.sqrt(rms / n)
    if (rms < rmsThreshold) return { freq: 0, clarity: 0, rms }

    // Normalised square difference function.
    for (let tau = minTau; tau <= maxTau; tau++) {
      let acf = 0
      let div = 0
      const limit = n - tau
      for (let j = 0; j < limit; j++) {
        const a = buf[j]
        const b = buf[j + tau]
        acf += a * b
        div += a * a + b * b
      }
      nsdf[tau] = div > 0 ? (2 * acf) / div : 0
    }

    // Collect the maximum of each positively-sloped region between zero
    // crossings; those are the candidate periods.
    const peaks = []
    let tau = minTau
    while (tau <= maxTau && nsdf[tau] > 0) tau++   // skip the leading lobe
    let bestTau = -1
    let bestVal = -1
    for (; tau <= maxTau; tau++) {
      if (nsdf[tau] > 0 && nsdf[tau - 1] <= 0) { bestTau = tau; bestVal = nsdf[tau] }
      else if (nsdf[tau] <= 0 && nsdf[tau - 1] > 0) {
        if (bestTau > 0) peaks.push({ tau: bestTau, val: bestVal })
        bestTau = -1; bestVal = -1
      } else if (bestTau > 0 && nsdf[tau] > bestVal) { bestTau = tau; bestVal = nsdf[tau] }
    }
    if (bestTau > 0) peaks.push({ tau: bestTau, val: bestVal })
    if (!peaks.length) return { freq: 0, clarity: 0, rms }

    let highest = 0
    for (const p of peaks) if (p.val > highest) highest = p.val
    if (highest < clarityThreshold) return { freq: 0, clarity: highest, rms }

    // Take the *earliest* peak that is close to the highest one. This is the
    // step that keeps us on the fundamental instead of a harmonic.
    const cutoff = highest * 0.9
    const chosen = peaks.find(p => p.val >= cutoff) || peaks[0]

    // Parabolic interpolation around the chosen lag for sub-sample accuracy.
    const t = chosen.tau
    const y0 = nsdf[t - 1] ?? chosen.val
    const y1 = chosen.val
    const y2 = nsdf[t + 1] ?? chosen.val
    const denom = 2 * (2 * y1 - y0 - y2)
    const shift = denom !== 0 ? (y2 - y0) / denom : 0
    const period = t + shift

    return { freq: sampleRate / period, clarity: chosen.val, rms }
  }
}
