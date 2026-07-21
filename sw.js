/**
 * Service worker — offline support for the installed PWA.
 *
 * Strategy: cache-first for same-origin GETs with runtime caching, so once the
 * game has been visited it plays fully offline (all modules, CSS and icons).
 * Navigations fall back to the cached shell when the network is unavailable.
 *
 * Paths are relative so this works whether the site is served from a domain
 * root or a project subpath like /Tetris/. Bump CACHE to ship an update — the
 * activate handler purges older caches.
 */

// Bump this on every shipped change — the worker is cache-first, so a stale
// cache name would keep serving old files to anyone who already installed it.
const CACHE = 'tetris-v2';

// The minimum needed to boot offline; everything else is cached on first fetch.
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/tokens.css',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/backgrounds.css',
  './css/animations.css',
  './js/main.js',
  './js/file-guard.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Individual failures must not abort the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // never touch cross-origin

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Cache successful, basic (same-origin) responses for next time.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // Offline and uncached: serve the app shell for navigations.
          if (request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
    })
  );
});
