// Audio capture for a take, straight off the microphone stream that the
// analyser is already using. Kept deliberately thin: start, stop, get a blob.

const CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',            // Safari
  'audio/ogg;codecs=opus'
]

export function supportedMimeType () {
  if (typeof MediaRecorder === 'undefined') return null
  return CANDIDATES.find(t => MediaRecorder.isTypeSupported?.(t)) || null
}

export function createRecorder () {
  let recorder = null
  let chunks = []

  return {
    get available () { return typeof MediaRecorder !== 'undefined' },
    get recording () { return recorder?.state === 'recording' },

    start (stream) {
      if (!stream || this.recording) return false
      const mimeType = supportedMimeType()
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      } catch {
        recorder = null
        return false
      }
      chunks = []
      recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data) }
      recorder.start(1000)      // flush every second so a long take is not one huge buffer
      return true
    },

    // Resolves with the finished audio, or null if nothing was captured.
    stop () {
      return new Promise(resolve => {
        if (!recorder || recorder.state === 'inactive') return resolve(null)
        recorder.onstop = () => {
          const blob = chunks.length ? new Blob(chunks, { type: chunks[0].type }) : null
          chunks = []
          recorder = null
          resolve(blob)
        }
        recorder.stop()
      })
    }
  }
}
