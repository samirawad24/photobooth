// Network first so updates arrive right away, with a cached copy so the
// booth still opens if the venue Wi-Fi drops.

const CACHE = 'cm-booth-v4';
const FILES = [
  './', 'index.html', 'styles.css', 'booth.js', 'config.js', 'filters.js', 'compose.js', 'store.js', 'sound.js', 'staff.js', 'share.js', 'uploader.js', 'vendor/qrcode.js',
  'manifest.webmanifest', 'robots.txt', 'fonts/cormorant.woff2', 'fonts/cormorant-italic.woff2', 'fonts/jost.woff2',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([
        fetch(req),
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000)),
      ]);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
