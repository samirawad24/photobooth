// Sends finished prints to the online photo service and delivers queued
// emails. Everything waits in storage on the iPad, so a Wi-Fi drop only
// delays things: it retries every 20 seconds and whenever the iPad is back online.

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
  if (!boothKey()) return { ready: false, text: 'Enter the booth key below to turn on QR codes and email.' };
  if (!navigator.onLine) return { ready: true, text: 'No internet right now. Prints will upload when it is back.' };
  if (lastError) return { ready: true, text: lastError };
  return { ready: true, text: 'Connected.' };
}

async function request(path, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { ...(init.headers || {}), 'X-Booth-Key': boothKey() },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function upload(item) {
  const res = await request(`/api/photo/${item.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: item.blob,
  });
  if (res.status === 401) throw Object.assign(new Error('The booth key is wrong. Check it in the staff panel.'), { stop: true });
  if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
  const data = await res.json().catch(() => ({}));
  return store.update(item.id, { uploaded: true, expiresAt: data.expiresAt || null });
}

async function sendEmails(item) {
  let changed = false;
  for (const e of item.emails || []) {
    if (e.status !== 'pending') continue;
    const res = await request('/api/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, to: e.to }),
    });
    if (res.status === 401) throw Object.assign(new Error('The booth key is wrong. Check it in the staff panel.'), { stop: true });
    if (res.ok) e.status = 'sent';
    // Bad address or too many: retrying will not help.
    else if (res.status === 400 || res.status === 429) e.status = 'failed';
    else throw new Error(`Email failed (${res.status}).`);
    changed = true;
  }
  if (changed) item = await store.update(item.id, { emails: item.emails });
  return item;
}

async function run() {
  if (!API_URL || !boothKey() || !navigator.onLine) return;
  const items = await store.all();
  // Newest first: the guests standing at the booth want theirs now.
  const todo = items.filter((i) => !i.uploaded || (i.emails || []).some((e) => e.status === 'pending')).reverse();
  lastError = '';
  for (let item of todo) {
    try {
      if (!item.uploaded) {
        item = await upload(item);
        emit(item);
      }
      if ((item.emails || []).some((e) => e.status === 'pending')) {
        item = await sendEmails(item);
        emit(item);
      }
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

export async function queueEmail(id, to) {
  const item = await store.get(id);
  if (!item) return;
  const emails = item.emails || [];
  if (!emails.some((e) => e.to === to)) emails.push({ to, status: 'pending' });
  const updated = await store.update(id, { emails });
  emit(updated);
  flush();
}

export async function pendingCounts() {
  const items = await store.all();
  return {
    uploads: items.filter((i) => !i.uploaded).length,
    emails: items.reduce((n, i) => n + (i.emails || []).filter((e) => e.status === 'pending').length, 0),
  };
}

window.addEventListener('online', () => flush());
setInterval(() => flush(), 20000);
