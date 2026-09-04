// Recorded takes live in IndexedDB, not localStorage: localStorage caps out
// around 5MB and only holds strings, while a minute of audio is roughly a
// megabyte of binary. Everything still stays on this machine — nothing is
// uploaded anywhere.
//
// Three stores so that listing takes is cheap: metadata is small and read on
// every list, while the pitch track and the audio are only fetched when a take
// is actually opened.

const DB_NAME = 'pitchscope'
const VERSION = 1
const META = 'meta'
const TRACK = 'track'
const AUDIO = 'audio'

let dbPromise = null

function openDb () {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(TRACK)) db.createObjectStore(TRACK)
      if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx (db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode)
    let result
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
    result = fn(t)
  })
}

export async function saveTake ({ meta, track, audio }) {
  const db = await openDb()
  await tx(db, [META, TRACK, AUDIO], 'readwrite', t => {
    t.objectStore(META).put(meta)
    t.objectStore(TRACK).put(track, meta.id)
    if (audio) t.objectStore(AUDIO).put(audio, meta.id)
  })
  return meta.id
}

export async function listTakes () {
  const db = await openDb()
  const all = await new Promise((resolve, reject) => {
    const req = db.transaction(META, 'readonly').objectStore(META).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
  return all.sort((a, b) => b.startedAt - a.startedAt)
}

export async function loadTake (id) {
  const db = await openDb()
  const get = (store, key) => new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const [meta, track, audio] = await Promise.all([get(META, id), get(TRACK, id), get(AUDIO, id)])
  return meta ? { meta, track, audio } : null
}

export async function deleteTake (id) {
  const db = await openDb()
  await tx(db, [META, TRACK, AUDIO], 'readwrite', t => {
    t.objectStore(META).delete(id)
    t.objectStore(TRACK).delete(id)
    t.objectStore(AUDIO).delete(id)
  })
}

export async function renameTake (id, name) {
  const db = await openDb()
  const meta = await new Promise((resolve, reject) => {
    const req = db.transaction(META, 'readonly').objectStore(META).get(id)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  if (!meta) return
  meta.name = name
  await tx(db, [META], 'readwrite', t => t.objectStore(META).put(meta))
}

// How much room the takes are using, when the browser will tell us.
export async function storageUsage () {
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch {
    return { usage: 0, quota: 0 }
  }
}
