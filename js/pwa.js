/**
 * Progressive Web App registration.
 *
 * Registration is skipped on localhost so a cache-first service worker never
 * serves stale modules during development — the production site (HTTPS) is
 * where offline install matters. Registered relative to the page, so the SW
 * scope matches whatever base path the site is served from.
 */

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const host = location.hostname;
  const isDev = host === 'localhost' || host === '127.0.0.1' || host === '';
  if (isDev) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .catch((err) => console.warn('Service worker registration failed:', err));
  });
}
