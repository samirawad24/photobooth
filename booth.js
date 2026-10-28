import { EVENT, PALETTE, LAYOUTS, LAYOUT_ORDER, THEME_ORDER, THEME_NAMES, FILTERS, FILTER_ORDER,
  IDLE_SECONDS, REVIEW_IDLE_SECONDS, COUNTDOWN } from './config.js';
import { createRenderer, cropFor } from './filters.js';
import { cells, compose, spray, fontsReady } from './compose.js';
import * as store from './store.js';
import * as sound from './sound.js';
import { initStaff, closeStaff } from './staff.js';
import { openShare, closeShare, sharingReady } from './share.js';
import * as uploader from './uploader.js';

const VERSION = 'v3';
// Prints match the mirrored preview, which is what guests expect to see.
const MIRROR = true;

const $ = (id) => document.getElementById(id);
const screens = ['welcome', 'layout', 'camera', 'review', 'share', 'thanks', 'staff'];
const video = $('video');
const view = $('view');
const frame = $('frame');

const preview = createRenderer(view);
const output = createRenderer(document.createElement('canvas'));
const thumbs = createRenderer(document.createElement('canvas'));

const state = {
  screen: 'welcome',
  layout: 'six',
  filter: 'natural',
  theme: 'sage',
  shots: [],
  shooting: false,
  // Bumped to cancel a running photo session (Back button, app hidden).
  session: 0,
  saving: false,
  rendered: {},
  printBlob: null,
  printUrl: null,
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Screens

function show(name) {
  for (const s of screens) $(s).hidden = s !== name;
  state.screen = name;
  touch();
  if (name === 'camera') startPreview();
  else stopPreview();
}

// Idle: put the booth back on the welcome screen when guests walk away.

let lastTouch = Date.now();
function touch() { lastTouch = Date.now(); }
['pointerdown', 'keydown'].forEach((e) => window.addEventListener(e, touch, { passive: true }));

setInterval(() => {
  const idle = (Date.now() - lastTouch) / 1000;
  if (state.screen === 'layout' && idle > IDLE_SECONDS) show('welcome');
  if (state.screen === 'camera' && !state.shooting && idle > IDLE_SECONDS) show('welcome');
  if (state.screen === 'review' && idle > REVIEW_IDLE_SECONDS) finish({ walkedAway: true });
  if (state.screen === 'share' && idle > REVIEW_IDLE_SECONDS) endShare();
  if (state.screen === 'staff' && idle > 180) closeStaff();
}, 2000);

// Keep the screen on while the booth runs.

let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch {}
}

// Camera

let stream = null;

function cameraLive() {
  const t = stream?.getVideoTracks()[0];
  return !!t && t.readyState === 'live';
}

async function startCamera() {
  if (cameraLive() && video.videoWidth) return;
  stopCamera();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1440 } },
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  const until = Date.now() + 5000;
  while ((!video.videoWidth || video.readyState < 2) && Date.now() < until) await wait(50);
  if (!video.videoWidth) throw new Error('No camera frames');
}

function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}

function cameraMessage(err) {
  if (!window.isSecureContext) return 'The camera only works over https. Open the booth from its web address.';
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser cannot open the camera. Use Safari on the iPad.';
  if (err?.name === 'NotAllowedError') return 'Camera access is turned off. Allow the camera for this site in Settings, then reopen the booth.';
  if (err?.name === 'NotReadableError') return 'Another app is using the camera. Close it and tap again.';
  return 'The camera did not start. Tap again, or close and reopen the booth.';
}

// Live viewfinder

let raf = 0;
let lastThumbs = 0;
const thumbSource = canvas(1, 1);

function sizeView() {
  const L = LAYOUTS[state.layout];
  const stage = $('stage');
  const hint = $('hint');
  const maxW = stage.clientWidth;
  const maxH = stage.clientHeight - hint.offsetHeight - 14;
  let w = maxW, h = maxW / L.aspect;
  if (h > maxH) { h = maxH; w = h * L.aspect; }
  w = Math.floor(w);
  h = Math.floor(h);
  frame.style.width = `${w}px`;
  frame.style.height = `${h}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.dataset.w = Math.round(w * dpr);
  view.dataset.h = Math.round(h * dpr);
}

function drawPreview(t) {
  raf = requestAnimationFrame(drawPreview);
  if (video.readyState < 2 || !video.videoWidth) return;
  const L = LAYOUTS[state.layout];
  const vw = video.videoWidth, vh = video.videoHeight;
  try {
    preview.draw(video, vw, vh, {
      w: +view.dataset.w, h: +view.dataset.h,
      filter: FILTERS[state.filter],
      crop: cropFor(vw, vh, L.aspect),
      mirror: true,
      seed: (t * 0.06) % 997,
    });
  } catch {}
  if (!state.shooting && t - lastThumbs > 900) {
    lastThumbs = t;
    drawFilterThumbs($('filters'), video, vw, vh, cropFor(vw, vh, L.aspect), true);
  }
}

function startPreview() {
  cancelAnimationFrame(raf);
  sizeView();
  lastThumbs = 0;
  raf = requestAnimationFrame(drawPreview);
}

function stopPreview() {
  cancelAnimationFrame(raf);
  raf = 0;
}

window.addEventListener('resize', () => {
  if (state.screen === 'camera') sizeView();
  if (state.screen === 'review') fitPrint();
  if (state.screen === 'welcome' || state.screen === 'thanks') drawArt();
});

// Filter pickers. Both pickers share this: each button shows the current
// picture through its own filter.

function buildFilterButtons(container, onPick) {
  container.innerHTML = '';
  for (const id of FILTER_ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filter';
    b.dataset.id = id;
    b.setAttribute('aria-pressed', id === state.filter);
    const c = document.createElement('canvas');
    const s = document.createElement('span');
    s.textContent = FILTERS[id].name;
    b.append(c, s);
    b.addEventListener('click', () => { sound.tap(); onPick(id); });
    container.append(b);
  }
}

function markFilter(container) {
  for (const b of container.children) b.setAttribute('aria-pressed', b.dataset.id === state.filter);
}

function drawFilterThumbs(container, source, sw, sh, crop, mirror) {
  const aspect = LAYOUTS[state.layout].aspect;
  const tw = 220;
  const th = Math.round(tw / aspect);
  // Shrink once, then filter the small copy eight times.
  thumbSource.width = tw;
  thumbSource.height = th;
  const tctx = thumbSource.getContext('2d');
  tctx.drawImage(source, crop[0] * sw, crop[1] * sh, crop[2] * sw, crop[3] * sh, 0, 0, tw, th);
  for (const b of container.children) {
    const c = b.querySelector('canvas');
    if (c.width !== tw) { c.width = tw; c.height = th; }
    try {
      thumbs.draw(thumbSource, tw, th, { w: tw, h: th, filter: FILTERS[b.dataset.id], mirror, seed: 3 });
      c.getContext('2d').drawImage(thumbs.canvas, 0, 0);
    } catch {}
  }
}

// Shooting

function grab() {
  const { cw, ch } = cells(state.layout);
  const vw = video.videoWidth, vh = video.videoHeight;
  const [cx, cy, cwr, chr] = cropFor(vw, vh, LAYOUTS[state.layout].aspect);
  const c = canvas(cw, ch);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, cx * vw, cy * vh, cwr * vw, chr * vh, 0, 0, cw, ch);
  return c;
}

function buildTray(n) {
  const tray = $('tray');
  tray.innerHTML = '';
  tray.classList.toggle('strip', state.layout === 'strip');
  const aspect = LAYOUTS[state.layout].aspect;
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'slot';
    d.style.aspectRatio = `${aspect}`;
    tray.append(d);
  }
}

function fillSlot(i, raw) {
  const slots = $('tray').children;
  [...slots].forEach((s, j) => s.classList.toggle('next', j === i + 1));
  const slot = slots[i];
  if (!slot) return;
  const c = canvas(raw.width, raw.height);
  output.draw(raw, raw.width, raw.height, { w: raw.width, h: raw.height, filter: FILTERS[state.filter], mirror: MIRROR, seed: 7 });
  c.getContext('2d').drawImage(output.canvas, 0, 0);
  slot.innerHTML = '';
  slot.append(c);
}

function setCount(text, word = false) {
  const el = $('count');
  el.classList.remove('tick', 'word');
  void el.offsetWidth;
  el.textContent = text;
  if (text) el.classList.add('tick');
  el.classList.toggle('word', word);
}

async function countdown(alive) {
  for (let k = COUNTDOWN; k > 0; k--) {
    if (!alive()) return;
    setCount(String(k));
    sound.beep();
    await wait(1000);
  }
  setCount('');
}

async function capture() {
  const flash = $('flash');
  flash.classList.add('on');
  // Give the white screen a moment to light faces before taking the frame.
  await wait(230);
  const raw = grab();
  sound.shutter();
  navigator.vibrate?.(20);
  await wait(60);
  flash.classList.remove('on');
  return raw;
}

function setShootingUI(on) {
  state.shooting = on;
  $('filters').hidden = on;
  $('filters-label').textContent = on ? 'Your photos' : 'Choose a filter';
  $('tray').hidden = !on;
  $('start').disabled = on;
  $('start').style.visibility = on ? 'hidden' : '';
}

async function shootSession() {
  if (state.shooting) return;
  try {
    await startCamera();
  } catch (err) {
    showWelcomeError(err);
    return;
  }
  const n = cells(state.layout).cells.length;
  const token = ++state.session;
  const alive = () => token === state.session && state.screen === 'camera';
  state.shots = [];
  state.rendered = {};
  buildTray(n);
  $('tray').children[0]?.classList.add('next');
  setShootingUI(true);

  for (let i = 0; i < n; i++) {
    $('progress').textContent = `Photo ${i + 1} of ${n}`;
    if (i === 0) {
      setCount('Get ready', true);
      await wait(1300);
    }
    if (!alive()) return;
    await countdown(alive);
    if (!alive()) return;
    const raw = await capture();
    if (!alive()) return;
    state.shots.push({ raw, seed: Math.random() * 500 });
    fillSlot(i, raw);
    if (i < n - 1) {
      setCount(n - i - 1 === 1 ? 'Last one' : 'Next pose', true);
      await wait(1500);
    }
  }

  if (!alive()) return;
  setCount('');
  setShootingUI(false);
  $('progress').textContent = '';
  if (state.shots.length < n) {
    state.shots = [];
    return;
  }
  await openReview();
}

$('start').addEventListener('click', () => {
  sound.unlock();
  sound.tap();
  touch();
  shootSession();
});

$('cam-back').addEventListener('click', () => {
  sound.tap();
  state.session++;
  setCount('');
  setShootingUI(false);
  show('layout');
});

// Review

function renderCells(filterId) {
  if (state.rendered[filterId]) return state.rendered[filterId];
  const out = state.shots.map(({ raw, seed }) => {
    const c = canvas(raw.width, raw.height);
    output.draw(raw, raw.width, raw.height, { w: raw.width, h: raw.height, filter: FILTERS[filterId], mirror: MIRROR, seed });
    c.getContext('2d').drawImage(output.canvas, 0, 0);
    return c;
  });
  state.rendered[filterId] = out;
  return out;
}

const toBlob = (c, q = 0.92) => new Promise((r) => c.toBlob(r, 'image/jpeg', q));

let renderToken = 0;
async function renderPrint() {
  const token = ++renderToken;
  const cellsDone = renderCells(state.filter);
  const print = compose(state.layout, state.theme, cellsDone);
  const blob = await toBlob(print);
  if (token !== renderToken || !blob) return;
  state.printBlob = blob;
  if (state.printUrl) URL.revokeObjectURL(state.printUrl);
  state.printUrl = URL.createObjectURL(blob);
  const img = $('print');
  img.src = state.printUrl;
  fitPrint();
}

function fitPrint() {
  const wrap = $('print-wrap');
  const L = LAYOUTS[state.layout];
  const img = $('print');
  const maxW = wrap.clientWidth, maxH = wrap.clientHeight;
  let h = maxH, w = h * (L.W / L.H);
  if (w > maxW) { w = maxW; h = w * (L.H / L.W); }
  img.style.width = `${Math.floor(w)}px`;
  img.style.height = `${Math.floor(h)}px`;
}

function buildThemes() {
  const box = $('themes');
  box.innerHTML = '';
  for (const id of THEME_ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme';
    b.dataset.id = id;
    b.setAttribute('aria-pressed', id === state.theme);
    const c = document.createElement('canvas');
    const s = document.createElement('span');
    s.textContent = THEME_NAMES[id];
    b.append(c, s);
    b.addEventListener('click', () => {
      if (state.theme === id) return;
      sound.tap();
      state.theme = id;
      for (const x of box.children) x.setAttribute('aria-pressed', x.dataset.id === id);
      renderPrint();
    });
    box.append(b);
  }
}

function drawThemeThumbs() {
  const cellsDone = renderCells(state.filter);
  const L = LAYOUTS[state.layout];
  const scale = 300 / L.H;
  for (const b of $('themes').children) {
    compose(state.layout, b.dataset.id, cellsDone, b.querySelector('canvas'), scale);
  }
}

function drawReviewFilterThumbs() {
  const raw = state.shots[0]?.raw;
  if (!raw) return;
  drawFilterThumbs($('review-filters'), raw, raw.width, raw.height, [0, 0, 1, 1], MIRROR);
}

async function openReview() {
  buildThemes();
  buildFilterButtons($('review-filters'), (id) => {
    state.filter = id;
    markFilter($('review-filters'));
    drawThemeThumbs();
    renderPrint();
  });
  show('review');
  drawReviewFilterThumbs();
  drawThemeThumbs();
  await renderPrint();
}

$('retake').addEventListener('click', () => {
  sound.tap();
  state.shots = [];
  state.rendered = {};
  openCamera();
});

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function finish({ walkedAway = false } = {}) {
  if (state.saving || state.screen !== 'review') return;
  state.saving = true;
  const id = newId();
  let blob = null;
  try {
    if (!state.printBlob) await renderPrint();
    blob = state.printBlob;
    if (blob) {
      await store.save({
        id,
        takenAt: Date.now(),
        layout: state.layout,
        theme: state.theme,
        filter: state.filter,
        blob,
        saved: false,
        uploaded: false,
        emails: [],
      });
      uploader.flush();
    }
  } finally {
    state.saving = false;
  }
  state.shots = [];
  state.rendered = {};
  state.printBlob = null;
  if (walkedAway) {
    show('welcome');
    return;
  }
  sound.chime();
  if (blob && sharingReady()) {
    show('share');
    await openShare(id, blob);
  } else {
    showThanks();
  }
}

function showThanks() {
  show('thanks');
  drawArt();
  setTimeout(() => { if (state.screen === 'thanks') show('welcome'); }, 4500);
}

function endShare() {
  closeShare();
  showThanks();
}

$('share-done').addEventListener('click', () => { sound.tap(); endShare(); });

$('done').addEventListener('click', () => { sound.tap(); finish(); });

// Layout choice

function buildLayouts() {
  const box = $('layouts');
  box.innerHTML = '';
  for (const id of LAYOUT_ORDER) {
    const L = LAYOUTS[id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'layout-card';
    const c = document.createElement('canvas');
    compose(id, 'cream', [], c, 0.32);
    const text = document.createElement('div');
    text.className = 'text';
    text.innerHTML = `<span class="name"></span><span class="detail"></span>`;
    text.querySelector('.name').textContent = L.label;
    text.querySelector('.detail').textContent = L.detail;
    b.append(c, text);
    b.addEventListener('click', () => {
      sound.tap();
      state.layout = id;
      state.filter = 'natural';
      openCamera();
    });
    box.append(b);
  }
}

function openCamera() {
  markFilter($('filters'));
  setShootingUI(false);
  $('progress').textContent = '';
  setCount('');
  show('camera');
}

$('layout-back').addEventListener('click', () => { sound.tap(); show('welcome'); });

// Welcome

function drawArt() {
  for (const id of ['welcome-art', 'thanks-art']) {
    const c = $(id);
    if (!c || !c.clientWidth) continue;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    spray(ctx, c.width / 2, c.height * 0.62, c.width * 0.9, {
      kind: id === 'thanks-art' ? 'eucalyptus' : 'olive',
      color: PALETTE.green,
      fill: 'rgba(62,85,65,0.14)',
      width: Math.max(1.5, c.width * 0.0042),
      leaves: 7,
    });
  }
}

function showWelcomeError(err) {
  const el = $('cam-error');
  el.textContent = cameraMessage(err);
  el.hidden = false;
  show('welcome');
}

let starting = false;
async function begin() {
  if (starting) return;
  starting = true;
  sound.unlock();
  sound.tap();
  keepAwake();
  store.persist();
  $('cam-error').hidden = true;
  try {
    await startCamera();
    show('layout');
  } catch (err) {
    showWelcomeError(err);
  } finally {
    starting = false;
  }
}

$('welcome').addEventListener('click', begin);

// iPad hands the camera back when the booth returns to the foreground.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state.shooting) {
      state.session++;
      setCount('');
      setShootingUI(false);
      $('progress').textContent = '';
    }
    stopPreview();
    return;
  }
  keepAwake();
  if (['layout', 'camera', 'review'].includes(state.screen)) {
    startCamera().then(() => { if (state.screen === 'camera') startPreview(); }).catch(showWelcomeError);
  }
});

// No pinch zoom or double-tap zoom on the kiosk.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => { if (e.target.id !== 'print') e.preventDefault(); });

// Start

async function boot() {
  $('welcome-names').innerHTML = '';
  $('welcome-names').append(EVENT.first + ' ', Object.assign(document.createElement('span'), { className: 'amp', textContent: '&' }), ' ' + EVENT.second);
  $('welcome-date').textContent = EVENT.dateText;
  $('version').textContent = VERSION;
  await fontsReady();
  buildLayouts();
  buildFilterButtons($('filters'), (id) => { state.filter = id; markFilter($('filters')); });
  drawArt();
  initStaff({ show });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
