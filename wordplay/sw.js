/* WordPlay Service Worker — кэш игры для офлайн-режима */
const CACHE = "wordplay-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./data.js",
  "./app.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// cache-first для локальных файлов, network-first не нужен (игра полностью офлайн)
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.method !== "GET") return;
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) => hit || fetch(e.request).then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return resp;
        }).catch(() => hit)
      )
    );
  } else {
    // шрифты/конфетти из CDN: сеть → иначе кэш
    e.respondWith(
      fetch(e.request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match(e.request))
    );
  }
});
