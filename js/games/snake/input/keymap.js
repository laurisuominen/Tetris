/**
 * Key bindings.
 *
 * Keyed on KeyboardEvent.code, which is layout-independent — so WASD stay
 * physically where they are on AZERTY, where the same letters are not.
 */

import { ACTIONS } from '../core/game.js';

export const DEFAULT_KEYMAP = Object.freeze({
  ArrowUp:    ACTIONS.UP,
  ArrowDown:  ACTIONS.DOWN,
  ArrowLeft:  ACTIONS.LEFT,
  ArrowRight: ACTIONS.RIGHT,

  KeyW: ACTIONS.UP,
  KeyS: ACTIONS.DOWN,
  KeyA: ACTIONS.LEFT,
  KeyD: ACTIONS.RIGHT,

  KeyP:   ACTIONS.PAUSE,
  Escape: ACTIONS.PAUSE
});

/**
 * Keys whose default browser behaviour must be suppressed.
 *
 * Space is deliberately absent: it is not bound to anything here, and binding
 * it would double-fire against any focused button that Space also activates.
 */
export const SCROLL_KEYS = Object.freeze(new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'
]));
