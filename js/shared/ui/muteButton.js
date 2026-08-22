/**
 * The mute toggle that sits in every game's action row.
 *
 * Pure DOM over the shared mute state. It owns no audio at all — a game's sfx
 * module reads whatever volume it is handed, so muting works by handing it
 * zero. See `withMute` in js/shared/audio/mute.js and each game's main.js.
 *
 * Three things are deliberate:
 *
 * - It is a TOGGLE BUTTON with `aria-pressed`, not a label that flips between
 *   "Mute" and "Unmute". A control whose accessible NAME changes under the user
 *   reads as a different control each time; the name stays "Mute" and the state
 *   rides on aria-pressed, which is what a screen reader announces.
 * - The icon is built with `createElementNS`, not `innerHTML` (banned here) and
 *   not an icon font or an SVG file (the repo ships zero binary assets). It is
 *   stroked in `currentColor`, so it inherits the ghost-button colour and needs
 *   no per-game palette entry.
 * - BOTH halves of the icon are in the DOM from the start and CSS hides one.
 *   Nothing is created or destroyed on click, so the toggle cannot get out of
 *   step with the state it is showing.
 */

import { on } from '../util/dom.js';
import { isTextTarget } from '../input/keyboard.js';
import { mute } from '../audio/mute.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function buildIcon() {
  const root = svg('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    // The button carries the accessible name; the glyph must not be announced
    // a second time.
    'aria-hidden': 'true',
    focusable: 'false'
  });

  // The cone is common to both states, so only the marks to its right swap.
  root.appendChild(svg('path', { d: 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z', fill: 'currentColor' }));

  const waves = svg('g', { class: 'mute-btn__waves' });
  waves.appendChild(svg('path', { d: 'M15.5 9.2a4 4 0 0 1 0 5.6' }));
  waves.appendChild(svg('path', { d: 'M18.2 6.5a8 8 0 0 1 0 11' }));

  const cross = svg('g', { class: 'mute-btn__cross' });
  cross.appendChild(svg('path', { d: 'M16 9.5l5 5' }));
  cross.appendChild(svg('path', { d: 'M21 9.5l-5 5' }));

  root.appendChild(waves);
  root.appendChild(cross);
  return root;
}

/**
 * @param {HTMLButtonElement|null} button
 * @returns {{ destroy: () => void }|null} null when the page has no such button
 */
export function createMuteButton(button, state = mute) {
  if (!button) return null;

  button.appendChild(buildIcon());

  function paint(muted) {
    button.setAttribute('aria-pressed', String(muted));
    // The accessible name is fixed; the tooltip a mouse user gets says what the
    // click will DO, which is the opposite of the current state.
    button.title = muted ? 'Unmute' : 'Mute';
  }

  paint(state.isMuted());
  const unsubscribe = state.subscribe(paint);
  on(button, 'click', () => state.toggle());

  return { destroy: unsubscribe };
}

/**
 * M toggles mute from anywhere on a game page.
 *
 * M is unbound in all five keymaps, checked rather than assumed. Two guards
 * matter: `isTextTarget` keeps it from firing into the initials field on the
 * game-over card — the same guard the Enter-to-restart handler needs, and for
 * the same reason — and the modifier check leaves Cmd+M (minimise) alone.
 */
export function bindMuteKey(state = mute) {
  const handler = (event) => {
    if (event.code !== 'KeyM') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTextTarget(event.target)) return;
    state.toggle();
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
