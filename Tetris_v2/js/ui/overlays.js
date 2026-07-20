/**
 * Start, pause and game-over overlays — spec §11.
 *
 * Real DOM with headings and buttons rather than text painted onto the canvas,
 * so screen readers can reach it and the buttons are keyboard-operable.
 * Focus moves into the card on open and returns where it came from on close.
 */

import { qs, setText, setHidden, clear, el, on } from '../util/dom.js';
import { STATES } from '../core/fsm.js';

const CONTROLS = [
  ['Move', '← →'],
  ['Soft / hard drop', '↓ / Space'],
  ['Rotate', '↑ or X / Z / A for 180°'],
  ['Hold', 'C or Shift'],
  ['Pause', 'P or Esc']
];

export function createOverlays({ onAction }) {
  const root = qs('#overlay');
  const card = qs('#overlay-card');
  const titleEl = qs('#overlay-title');
  const bodyEl = qs('#overlay-body');
  const actionsEl = qs('#overlay-actions');

  let lastFocused = null;
  let currentKind = null;

  function button(label, action, variant = '') {
    const node = el('button', {
      text: label,
      className: `btn ${variant}`.trim(),
      attrs: { type: 'button' }
    });
    on(node, 'click', () => onAction(action));
    return node;
  }

  function open(kind, { title, body, buttons }) {
    currentKind = kind;
    lastFocused = document.activeElement;

    setText(titleEl, title);
    setText(bodyEl, body ?? '');
    setHidden(bodyEl, !body);

    clear(actionsEl);
    for (const node of buttons) actionsEl.appendChild(node);

    setHidden(root, false);
    // Focus the primary action so Enter works without reaching for the mouse.
    requestAnimationFrame(() => actionsEl.querySelector('button')?.focus());
  }

  function close() {
    currentKind = null;
    setHidden(root, true);
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
    lastFocused = null;
  }

  // Keep Tab inside the card while it is open.
  on(root, 'keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(card.querySelectorAll('button'));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const controlsText = CONTROLS.map(([name, keys]) => `${name}   ${keys}`).join('\n');

  return {
    showStart() {
      open('start', {
        title: 'Tetris',
        body: controlsText,
        buttons: [button('Play', 'start')]
      });
    },

    showPaused() {
      open('paused', {
        title: 'Paused',
        body: controlsText,
        buttons: [button('Resume', 'resume'), button('Restart', 'restart', 'btn--ghost')]
      });
    },

    showGameOver(state) {
      open('gameover', {
        title: 'Game Over',
        body: `Score ${state.score.toLocaleString()}\n`
            + `Level ${state.level}   Lines ${state.lines}`,
        buttons: [button('Play again', 'restart')]
      });
    },

    close,
    get isOpen() { return currentKind !== null; },
    get kind() { return currentKind; },

    /** Drives the overlay purely from FSM state, so it can never disagree. */
    syncTo(state) {
      switch (state.fsm) {
        case STATES.MENU:      this.showStart(); break;
        case STATES.PAUSED:    this.showPaused(); break;
        case STATES.GAME_OVER: this.showGameOver(state); break;
        default:               if (currentKind) close();
      }
    }
  };
}
