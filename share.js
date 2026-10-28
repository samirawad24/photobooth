// "Take it home" screen after a print is finished: a QR code guests scan
// with their phone camera to open and save their print.

import * as uploader from './uploader.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);

let current = null;
let imgUrl = null;

export function sharingReady() {
  return uploader.status().ready;
}

function drawQr(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 3;
  const c = $('qr');
  const size = c.clientWidth || 280;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = Math.floor((size * dpr) / (n + quiet * 2));
  c.width = c.height = px * (n + quiet * 2);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#1F2E24';
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(r, col)) ctx.fillRect((col + quiet) * px, (r + quiet) * px, px, px);
    }
  }
  c.classList.add('ready');
}

function renderQr(item) {
  const c = $('qr');
  const statusEl = $('qr-status');
  if (item.uploaded) {
    drawQr(uploader.linkFor(item.id));
    statusEl.textContent = 'It opens your print so you can save it to your phone. The link works for 2 weeks.';
    return;
  }
  c.classList.remove('ready');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
  statusEl.textContent = navigator.onLine
    ? 'Getting your link ready...'
    : 'No internet right now. The code shows up as soon as the connection is back.';
}

uploader.onChange((item) => {
  if (!current || !item || item.id !== current.id) return;
  current = item;
  renderQr(item);
});

window.addEventListener('online', () => { if (current) renderQr(current); });
window.addEventListener('offline', () => { if (current) renderQr(current); });

export async function openShare(id, blob) {
  current = (await store.get(id)) || { id };
  if (imgUrl) URL.revokeObjectURL(imgUrl);
  imgUrl = URL.createObjectURL(blob);
  $('share-img').src = imgUrl;
  // Wait a frame so the canvas has its on-screen size before drawing.
  requestAnimationFrame(() => renderQr(current));
  uploader.flush();
}

export function closeShare() {
  current = null;
}
