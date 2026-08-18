/**
 * Key bindings.
 *
 * Keyed on KeyboardEvent.code, which is layout-independent — so A/D stay
 * physically where they are on AZERTY, where the same letters are not.
 *
 * Steering and FIRING are both held, and neither is in the game's ACTIONS
 * vocabulary. Core reads an axis and a boolean; a queued "fire" name nothing
 * consumes would be a silent leak, which is why both go in `suppressInitial`
 * as well as `heldActions`. Breakout established the pattern for the axis; the
 * only new part here is that the trigger uses it too.
 */

import { ACTIONS } from '../core/game.js';

export const HELD_ACTIONS = Object.freeze({
  LEFT: 'HB_LEFT',
  RIGHT: 'HB_RIGHT',
  FIRE: 'HB_FIRE'
});

export const DEFAULT_KEYMAP = Object.freeze({
  ArrowLeft:  HELD_ACTIONS.LEFT,
  ArrowRight: HELD_ACTIONS.RIGHT,
  KeyA:       HELD_ACTIONS.LEFT,
  KeyD:       HELD_ACTIONS.RIGHT,

  // Space is the trigger, held rather than tapped. The gun's own cooldown
  // decides the rate, so holding it is not an advantage over tapping — it is
  // just less painful, which is why auto-fire exists as a setting too.
  Space:      HELD_ACTIONS.FIRE,

  KeyP:   ACTIONS.PAUSE,
  Escape: ACTIONS.PAUSE
});

/**
 * Keys whose default browser behaviour must be suppressed.
 *
 * Space is bound here, so it is included: left alone it scrolls the page, and
 * on a focused button it would also activate that button.
 */
export const SCROLL_KEYS = Object.freeze(new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'
]));
