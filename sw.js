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
 *
 * Everything this worker PUTS into the cache is fetched with `cache: 'reload'`.
 * That is load-bearing, and it is not obvious: a plain `fetch()` inside a
 * service worker still consults the browser's HTTP cache. GitHub Pages serves
 * these assets with `cache-control: max-age=600`, so for ten minutes after a
 * deploy a returning visitor's freshly-installed worker could pull PRE-deploy
 * bytes out of the HTTP cache and `cache.put` them into the brand-new cache
 * generation. Assets are cache-first, so that stale copy is then pinned
 * indefinitely — and bumping CACHE cannot dislodge it, because the bump is what
 * created the poisoned generation in the first place. Measured 2026-07-29 on
 * the live site: cache list was exactly ['arcade-v4'] with the v4 worker
 * active, yet the worker served a pre-deploy scoresView.js while the same URL
 * with `cache: 'reload'` returned the deployed one.
 *
 * Navigations deliberately do NOT get this treatment — see the fetch handler.
 */

// Bump this on every shipped change. Assets are cache-first, so a stale cache
// name keeps serving old files to anyone who already has the site installed.
const CACHE = 'arcade-v6';

// Cache mode for every request whose response we intend to store. Bypasses the
// browser HTTP cache entirely, so what lands in the cache is what the origin is
// serving right now. See the note above.
const FRESH = { cache: 'reload' };

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
      // Individual failures must not abort the whole install. `cache.add(url)`
      // would go through the HTTP cache, so the shell is requested explicitly.
      .then((cache) => Promise.allSettled(
        SHELL.map((url) => cache.add(new Request(url, FRESH)))
      ))
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
  //
  // This one keeps the plain `fetch(request)`. A navigation Request cannot be
  // reconstructed — `new Request(navigationRequest, …)` downgrades mode to
  // 'same-origin' and redirect to 'follow', and responding to a navigation with
  // a followed-redirect response is a TypeError. The staleness risk is also far
  // smaller here: the document is network-first, so a max-age copy is replaced
  // on the next navigation rather than pinned, and it is the same freshness an
  // ordinary browser navigation would get with no worker installed at all.
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

      // A cache miss is the only path that writes an asset, so this runs once
      // per asset per cache generation — the cost of bypassing the HTTP cache
      // is one conditional-free request, paid once, to avoid pinning a stale
      // file forever.
      return fetch(new Request(request, FRESH))
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
