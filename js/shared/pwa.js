/**
 * Progressive Web App registration.
 *
 * Registration is skipped on localhost so a cache-first service worker never
 * serves stale modules during development — the production site (HTTPS) is
 * where offline install matters.
 *
 * One worker at the site root covers the whole arcade. It is registered by
 * absolute path rather than relative to the page, because a game at
 * /games/<name>/ imports shared modules from /js/shared/ — outside a
 * game-scoped worker's reach. A single root scope is the only arrangement
 * where the worker controls everything it caches.
 *
 * This is a deliberate change from the single-game layout, which registered
 * './sw.js' so the site could also be served from a project subpath like
 * /Tetris/. The site has a custom domain at the origin root (see CNAME), so
 * that portability is no longer load-bearing.
 */

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const host = location.hostname;
  const isDev = host === 'localhost' || host === '127.0.0.1' || host === '';
  if (isDev) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('Service worker registration failed:', err));
  });
}
