/**
 * Renders the arcade game grid from the registry.
 *
 * Every card is built with el()/setText() — there is no innerHTML path in
 * shared/util/dom.js by design, so a game title can never become markup.
 *
 * A playable game is an <a>: real navigation, real focus, works with middle
 * click and "open in new tab". A pending game is a <div> marked
 * aria-disabled, so assistive tech announces it as present but unavailable
 * rather than as a broken link.
 */

import { el, qs } from '../shared/util/dom.js';
import { registerServiceWorker } from '../shared/pwa.js';
import { GAMES, isPlayable } from './registry.js';

function card(game) {
  const playable = isPlayable(game);

  const node = el(playable ? 'a' : 'div', {
    className: `card${playable ? '' : ' card--soon'}`,
    attrs: playable
      ? { href: game.path }
      : { 'aria-disabled': 'true' }
  });

  const mark = el('span', {
    text: game.mark,
    className: 'card__mark',
    attrs: { 'aria-hidden': 'true' }
  });
  mark.style.setProperty('--card-accent', game.accent);

  const body = el('span', { className: 'card__body' });
  body.appendChild(el('span', { text: game.title, className: 'card__title' }));
  body.appendChild(el('span', { text: game.blurb, className: 'card__blurb' }));

  const status = el('span', {
    text: playable ? 'Play' : 'Coming soon',
    className: `card__status${playable ? '' : ' card__status--soon'}`
  });
  body.appendChild(status);

  node.appendChild(mark);
  node.appendChild(body);
  return node;
}

export function renderHub(root = qs('#games')) {
  if (!root) return;
  for (const game of GAMES) root.appendChild(card(game));
}

renderHub();

// The hub is the install target for the arcade as a whole, and it is also the
// page that retires the old single-game worker — see sw.js.
registerServiceWorker();
