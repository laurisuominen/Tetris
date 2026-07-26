/**
 * Classic (non-module) script — loads fine over file://, unlike everything else
 * in js/. Native ES modules are fetched under CORS rules and file:// origins are
 * opaque, so main.js would fail with a console error and a blank page.
 *
 * This turns that into an actionable message. Uses textContent throughout; the
 * CSP forbids inline script, which is why this lives in its own file.
 */
(function () {
  'use strict';
  if (location.protocol !== 'file:') return;

  document.addEventListener('DOMContentLoaded', function () {
    var lines = [
      'This version needs to be served over HTTP.',
      '',
      'Browsers block JavaScript modules loaded from file:// URLs, so opening',
      'this page by double-clicking it cannot work. To play locally, run:',
      '',
      '    python -m http.server 8000',
      '',
      'from this directory, then open http://localhost:8000',
      '',
      'Alternatively, Tetris_v1/index.html runs fine by double-clicking.'
    ];

    var pre = document.createElement('pre');
    pre.className = 'file-guard';
    pre.textContent = lines.join('\n');

    document.body.textContent = '';
    document.body.appendChild(pre);
  });
})();
