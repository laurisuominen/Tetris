/**
 * Service worker — offline support for the whole arcade.
 *
 * One worker at the origin root covers the hub and every game. A game-scoped
 * worker would not do: games at /games/<name>/ import shared modules from
 * /js/shared/, which is outside their scope, so the root worker would end up
 * fetching them anyway.
 *
 * Strategy, and the reason it differs from the single-game worker it replaces:
 *
 *   - Navigations are NETWORK-FIRST, falling back to cache when offline. The
 *     old worker was cache-first for everything, which is exactly why this
 *     migration is delicate: a cache-first root document pins the site to
 *     whatever was cached first and no amount of deploying can dislodge it.
 *     Network-first makes that failure structurally impossible.
 *   - Static assets stay CACHE-FIRST with runtime caching, so a visited game
 *     still plays fully offline.
 *
 * Bump CACHE to ship an update; activate purges every other cache, which is
 * also what retires the old 'tetris-v2.1' cache from the single-game site.
 */

// Bump this on every shipped change. Assets are cache-first, so a stale cache
// name keeps serving old files to anyone who already has the site installed.
const CACHE = 'arcade-v3';

// The minimum needed to boot the hub offline; everything else — including each
// game's modules — is cached on first fetch.
const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/tokens.css',
  '/css/hub.css',
  '/js/hub/hub.js',
  '/js/hub/registry.js',
  '/js/shared/util/dom.js',
  '/js/shared/pwa.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
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

  // Navigations: network first. A stale document must never outlive a deploy.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () =>
          // Offline: the page itself if we have it, otherwise the hub.
          (await caches.match(request)) ?? (await caches.match('/index.html')) ?? Response.error()
        )
    );
    return;
  }

  // Everything else: cache first, populating the cache as we go.
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
        .catch(() => Response.error());
    })
  );
});
