// Sends finished prints to the online photo service so the QR code has
// something to open. Everything waits in storage on the iPad, so a Wi-Fi
// drop only delays things: it retries every 20 seconds and whenever the iPad
// is back online.

import { API_URL } from './config.js';
import * as store from './store.js';

const KEY_NAME = 'cm-booth:key';
const listeners = new Set();
let running = null;
let lastError = '';

export function boothKey() {
  try { return localStorage.getItem(KEY_NAME) || ''; } catch { return ''; }
}

export function setBoothKey(key) {
  try { localStorage.setItem(KEY_NAME, key.trim()); } catch {}
  flush();
}

export const linkFor = (id) => `${API_URL}/p/${id}`;

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(item) {
  for (const fn of listeners) {
    try { fn(item); } catch {}
  }
}

export function status() {
  if (!API_URL) return { ready: false, text: 'Online sharing is not set up yet.' };
  if (!boothKey()) return { ready: false, text: 'Enter the booth key below to turn on QR codes.' };
  if (!navigator.onLine) return { ready: true, text: 'No internet right now. Prints will upload when it is back.' };
  if (lastError) return { ready: true, text: lastError };
  return { ready: true, text: 'Connected.' };
}

async function upload(item) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  let res;
  try {
    res = await fetch(`${API_URL}/api/photo/${item.id}`, {
      method: 'PUT',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'image/jpeg', 'X-Booth-Key': boothKey() },
      body: item.blob,
    });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) throw Object.assign(new Error('The booth key is wrong. Check it in the staff panel.'), { stop: true });
  if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
  const data = await res.json().catch(() => ({}));
  return store.update(item.id, { uploaded: true, expiresAt: data.expiresAt || null });
}

async function run() {
  if (!API_URL || !boothKey() || !navigator.onLine) return;
  // Newest first: the guests standing at the booth want theirs now.
  const todo = (await store.all()).filter((i) => !i.uploaded).reverse();
  lastError = '';
  for (const item of todo) {
    try {
      emit(await upload(item));
    } catch (err) {
      lastError = err.name === 'AbortError' ? 'The connection is slow. Retrying.' : (err.message || 'Upload failed. Retrying.');
      if (err.stop || err.name === 'TypeError') break;
    }
  }
}

let again = false;
export function flush() {
  if (running) {
    again = true;
    return running;
  }
  running = run().finally(() => {
    running = null;
    if (again) {
      again = false;
      flush();
    }
  });
  return running;
}

export async function pendingUploads() {
  return (await store.all()).filter((i) => !i.uploaded).length;
}

window.addEventListener('online', () => flush());
setInterval(() => flush(), 20000);
