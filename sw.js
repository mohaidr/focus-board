const CACHE_VERSION = 32;
const CACHE_NAME = `dashora-v${CACHE_VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/markdown.js',
  './js/share.js',
  './js/dashboard.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm',
  'https://cdn.jsdelivr.net/npm/marked@18.1.0/lib/marked.umd.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.min.js',
  'https://cdn.jsdelivr.net/npm/turndown@7.2.2/dist/turndown.js',
  'https://cdn.jsdelivr.net/npm/turndown-plugin-gfm@1.0.2/dist/turndown-plugin-gfm.js',
];

// External CDN assets that are safe to cache long-term
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Cache-first for CDN/external assets (they're versioned and don't change)
  if (CDN_HOSTS.some((h) => url.hostname === h)) {
    e.respondWith(
      caches.match(e.request).then((cached) =>
        cached || fetch(e.request).then((resp) => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return resp;
        })
      )
    );
    return;
  }

  // Network-first for all local assets — always get the latest
  e.respondWith(
    fetch(e.request).then((resp) => {
      if (resp && resp.status === 200) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
      }
      return resp;
    }).catch(() => caches.match(e.request).then((cached) =>
      cached || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)
    ))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        await client.focus();
        return;
      }
    }
    if (clients.openWindow) {
      await clients.openWindow('./index.html');
    }
  })());
});
