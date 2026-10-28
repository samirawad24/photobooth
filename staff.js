// Staff panel: PIN-locked gallery of every print, with batch saving to the
// iPad camera roll through the share sheet ("Save Images").

import { STAFF_PIN, SAVE_BATCH, EVENT } from './config.js';
import * as store from './store.js';
import * as sound from './sound.js';
import * as uploader from './uploader.js';

const $ = (id) => document.getElementById(id);

let showScreen = () => {};
let items = [];
let urls = [];
// Files are read from storage before the button is tapped: iPad only opens
// the share sheet straight from a tap, with no waiting in between.
let nextBatch = { ids: [], files: [] };
let allBatches = [];
let allIndex = 0;
let deleteArmed = 0;

const slug = `${EVENT.first}-${EVENT.second}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

function fileFor(item) {
  const n = String(items.indexOf(item) + 1).padStart(4, '0');
  return new File([item.blob], `${slug}-${n}.jpg`, { type: 'image/jpeg', lastModified: item.takenAt });
}

const canShareFiles = (files) => {
  try { return !!navigator.canShare?.({ files }); } catch { return false; }
};

// Returns 'saved', 'cancelled' or 'downloaded'.
async function shareFiles(files) {
  if (canShareFiles(files)) {
    try {
      await navigator.share({ files });
      return 'saved';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  // Computers without a share sheet: download them instead.
  for (const f of files) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(f);
    a.href = url;
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    await new Promise((r) => setTimeout(r, 300));
  }
  return 'downloaded';
}

function note(text, tone = '') {
  const el = $('staff-note');
  el.textContent = text;
  el.dataset.tone = tone;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

async function refresh() {
  items = await store.all();
  const unsaved = items.filter((i) => !i.saved);
  nextBatch = { ids: unsaved.slice(0, SAVE_BATCH).map((i) => i.id), files: unsaved.slice(0, SAVE_BATCH).map(fileFor) };
  allBatches = [];
  for (let i = 0; i < items.length; i += SAVE_BATCH) allBatches.push(items.slice(i, i + SAVE_BATCH));
  if (allIndex >= allBatches.length) allIndex = 0;

  $('st-total').textContent = items.length;
  $('st-total-word').textContent = items.length === 1 ? 'print' : 'prints';
  $('st-new').textContent = unsaved.length;

  const saveNew = $('save-new');
  saveNew.disabled = unsaved.length === 0;
  saveNew.textContent = unsaved.length === 0
    ? 'All saved to Photos'
    : unsaved.length > SAVE_BATCH
      ? `Save next ${SAVE_BATCH} to Photos`
      : `Save ${unsaved.length} to Photos`;

  const saveAll = $('save-all');
  saveAll.hidden = items.length === 0;
  saveAll.textContent = allBatches.length > 1
    ? `Save all again (part ${allIndex + 1} of ${allBatches.length})`
    : 'Save all again';
  $('delete-all').hidden = items.length === 0;
  disarmDelete();

  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage) {
      const mb = est.usage / 1048576;
      const free = est.quota ? Math.max(0, (est.quota - est.usage) / 1073741824) : null;
      $('st-storage').textContent = `${mb < 1024 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`} used${free !== null ? `, ${free.toFixed(1)} GB free` : ''}`;
    }
  } catch {}

  renderGallery();
  renderOnline();
}

function renderGallery() {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
  const box = $('gallery');
  box.innerHTML = '';
  $('gallery-empty').hidden = items.length > 0;
  // Newest first, the way people look for "the one we just took".
  [...items].reverse().forEach((item) => {
    const url = URL.createObjectURL(item.blob);
    urls.push(url);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shot';
    const img = document.createElement('img');
    img.src = url;
    img.loading = 'lazy';
    img.alt = `Print ${items.indexOf(item) + 1}`;
    const cap = document.createElement('span');
    const time = new Date(item.takenAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    cap.textContent = item.saved ? `${time}, saved` : `${time}, not saved`;
    cap.className = item.saved ? 'is-saved' : '';
    b.append(img, cap);
    b.addEventListener('click', () => openViewer(item, url));
    box.append(b);
  });
}

// Single photo viewer

let viewerFile = null;
let viewerId = null;

function openViewer(item, url) {
  sound.tap();
  viewerFile = fileFor(item);
  viewerId = item.id;
  $('viewer-img').src = url;
  $('viewer').hidden = false;
}

$('viewer-close').addEventListener('click', () => { $('viewer').hidden = true; });

$('viewer-save').addEventListener('click', async () => {
  try {
    const r = await shareFiles([viewerFile]);
    if (r !== 'cancelled') {
      await store.markSaved([viewerId]);
      note('Saved.', 'ok');
      $('viewer').hidden = true;
      refresh();
    }
  } catch {
    note('That did not save. Try again.', 'bad');
  }
});

// Batch saving

$('save-new').addEventListener('click', async () => {
  if (!nextBatch.files.length) return;
  const { ids, files } = nextBatch;
  try {
    const r = await shareFiles(files);
    if (r === 'cancelled') {
      note('Cancelled. Nothing was marked as saved.');
      return;
    }
    await store.markSaved(ids);
    note(r === 'saved'
      ? `${plural(ids.length, 'photo')} sent to the share sheet. If you tapped Save Images they are in Photos now.`
      : `${plural(ids.length, 'photo')} downloaded.`, 'ok');
    await refresh();
  } catch {
    note('The share sheet did not open. Tap the button again.', 'bad');
  }
});

$('save-all').addEventListener('click', async () => {
  const batch = allBatches[allIndex];
  if (!batch) return;
  const files = batch.map(fileFor);
  try {
    const r = await shareFiles(files);
    if (r === 'cancelled') return;
    await store.markSaved(batch.map((i) => i.id));
    allIndex = (allIndex + 1) % allBatches.length;
    note(allIndex === 0 ? 'Finished the last part.' : `Part done. Tap again for part ${allIndex + 1}.`, 'ok');
    await refresh();
  } catch {
    note('The share sheet did not open. Tap the button again.', 'bad');
  }
});

// Delete needs two taps so it never happens by accident.

function disarmDelete() {
  deleteArmed = 0;
  $('delete-all').textContent = 'Delete all photos';
  $('delete-all').classList.remove('armed');
}

$('delete-all').addEventListener('click', async () => {
  const unsaved = items.filter((i) => !i.saved).length;
  if (Date.now() - deleteArmed > 5000) {
    deleteArmed = Date.now();
    $('delete-all').textContent = unsaved
      ? `Tap again to delete all ${items.length}. ${unsaved} not saved yet!`
      : `Tap again to delete all ${items.length}`;
    $('delete-all').classList.add('armed');
    setTimeout(() => { if (deleteArmed && Date.now() - deleteArmed >= 5000) disarmDelete(); }, 5100);
    return;
  }
  await store.clear();
  allIndex = 0;
  note('All photos deleted from this iPad.', 'ok');
  refresh();
});

// Online sharing

async function renderOnline() {
  $('online-status').textContent = uploader.status().text;
  const n = await uploader.pendingUploads();
  $('online-counts').textContent = n ? `${n} ${n === 1 ? 'print' : 'prints'} waiting to upload` : 'Everything is uploaded.';
  $('key-input').placeholder = uploader.boothKey() ? 'Booth key is saved (type to replace)' : 'Booth key';
}

$('key-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = $('key-input').value.trim();
  if (!key) return;
  uploader.setBoothKey(key);
  $('key-input').value = '';
  $('key-input').blur();
  note('Booth key saved.', 'ok');
  await uploader.flush();
  renderOnline();
});

$('retry-now').addEventListener('click', async () => {
  sound.tap();
  note('Retrying...');
  await uploader.flush();
  note('');
  renderOnline();
});

uploader.onChange(() => { if (!$('staff').hidden) renderOnline(); });

$('staff-close').addEventListener('click', () => {
  sound.tap();
  close();
});

function close() {
  $('viewer').hidden = true;
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
  $('gallery').innerHTML = '';
  note('');
  showScreen('welcome');
}

// Secret entry: 5 quick taps in the top left corner of the welcome screen.

let taps = [];
$('secret').addEventListener('click', (e) => {
  e.stopPropagation();
  const now = Date.now();
  taps = taps.filter((t) => now - t < 3000);
  taps.push(now);
  if (taps.length >= 5) {
    taps = [];
    openPin();
  }
});

// PIN pad

let entered = '';

function drawDots() {
  [...$('pin-dots').children].forEach((d, i) => d.classList.toggle('on', i < entered.length));
}

function openPin() {
  entered = '';
  drawDots();
  $('pin').hidden = false;
}

function closePin() {
  $('pin').hidden = true;
  entered = '';
}

$('pin').addEventListener('click', (e) => e.stopPropagation());
$('pin-cancel').addEventListener('click', closePin);

$('pin-keys').addEventListener('click', async (e) => {
  const key = e.target.closest('button')?.dataset.key;
  if (!key) return;
  sound.tap();
  if (key === 'del') entered = entered.slice(0, -1);
  else if (entered.length < STAFF_PIN.length) entered += key;
  drawDots();
  if (entered.length === STAFF_PIN.length) {
    if (entered === STAFF_PIN) {
      closePin();
      note('');
      showScreen('staff');
      await refresh();
    } else {
      const dots = $('pin-dots');
      dots.classList.remove('shake');
      void dots.offsetWidth;
      dots.classList.add('shake');
      entered = '';
      setTimeout(drawDots, 350);
    }
  }
});

export function initStaff({ show }) {
  showScreen = show;
}

export function closeStaff() {
  if (!$('staff').hidden) close();
}
