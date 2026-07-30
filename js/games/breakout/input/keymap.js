/**
 * Key bindings.
 *
 * Keyed on KeyboardEvent.code, which is layout-independent — so A/D stay
 * physically where they are on AZERTY, where the same letters are not.
 *
 * Left and right are NOT in the game's ACTIONS vocabulary. A paddle moves
 * continuously, so holding a key has to produce a sustained axis rather than a
 * stream of discrete events; these two names exist only so the shared keyboard
 * module has something to track as held, and core reads the resulting axis.
 * See input/keyboard.js.
 */

import { ACTIONS } from '../core/game.js';

export const AXIS_ACTIONS = Object.freeze({
  LEFT: 'PADDLE_LEFT',
  RIGHT: 'PADDLE_RIGHT'
});

export const DEFAULT_KEYMAP = Object.freeze({
  ArrowLeft:  AXIS_ACTIONS.LEFT,
  ArrowRight: AXIS_ACTIONS.RIGHT,
  KeyA:       AXIS_ACTIONS.LEFT,
  KeyD:       AXIS_ACTIONS.RIGHT,

  // Space serves. It is the one key every Breakout has used since the paddle
  // controller stopped having a button on it.
  Space: ACTIONS.LAUNCH,

  KeyP:   ACTIONS.PAUSE,
  Escape: ACTIONS.PAUSE
});

/**
 * Keys whose default browser behaviour must be suppressed.
 *
 * Space is included here and NOT in Snake's list, because here it is bound.
 * Left unsuppressed it scrolls the page, and on a focused button it would also
 * activate that button — which is why the shared module only suppresses keys
 * that are mapped and only outside form controls.
 */
export const SCROLL_KEYS = Object.freeze(new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'
]));
