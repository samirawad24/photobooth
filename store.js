// Keeps every finished print on the iPad (IndexedDB) the moment it is made,
// so nothing is lost before it reaches the camera roll. Falls back to memory
// if storage is blocked, which only lasts until the page reloads.

const DB_NAME = 'cm-booth';
const STORE = 'photos';
let dbPromise = null;
const memory = new Map();

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function run(mode, fn) {
  return db().then((conn) => new Promise((resolve, reject) => {
    if (!conn) { reject(new Error('no db')); return; }
    const t = conn.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export async function persist() {
  try { await navigator.storage?.persist?.(); } catch {}
}

export async function save(item) {
  try { await run('readwrite', (s) => s.put(item)); }
  catch { memory.set(item.id, item); }
}

export async function all() {
  let stored = [];
  try { stored = (await run('readonly', (s) => s.getAll())) || []; } catch {}
  return [...stored, ...memory.values()].sort((a, b) => a.takenAt - b.takenAt);
}

export async function count() {
  try { return ((await run('readonly', (s) => s.count())) || 0) + memory.size; }
  catch { return memory.size; }
}

export async function markSaved(ids) {
  const set = new Set(ids);
  for (const item of await all()) {
    if (!set.has(item.id) || item.saved) continue;
    item.saved = true;
    if (memory.has(item.id)) memory.set(item.id, item);
    else {
      try { await run('readwrite', (s) => s.put(item)); } catch {}
    }
  }
}

export async function clear() {
  memory.clear();
  try { await run('readwrite', (s) => s.clear()); } catch {}
}
