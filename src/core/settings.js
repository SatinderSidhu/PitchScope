// Settings persistence. Every configurable control is stored under one key so
// a returning singer finds their Sa, scale, tempo and labelling exactly as they
// left them. Storage can throw (private browsing, disabled site data), so every
// access is guarded and the app falls back to defaults rather than failing.

const KEY = 'pitchscope.settings.v1'

export function loadSettings () {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveSettings (settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch { /* storage unavailable — the session still works, it just won't persist */ }
}

export function clearSettings () {
  try { localStorage.removeItem(KEY) } catch { /* nothing to do */ }
}
