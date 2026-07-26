/**
 * Key bindings — spec §10.
 *
 * Keyed on KeyboardEvent.code, not the deprecated keyCode v1 used throughout.
 * code is layout-independent, so ZXC stay physically where they are on AZERTY.
 */

import { ACTIONS } from '../core/game.js';

export const DEFAULT_KEYMAP = Object.freeze({
  ArrowLeft:    ACTIONS.MOVE_LEFT,
  ArrowRight:   ACTIONS.MOVE_RIGHT,
  ArrowDown:    ACTIONS.SOFT_DROP,
  Space:        ACTIONS.HARD_DROP,

  ArrowUp:      ACTIONS.ROTATE_CW,
  KeyX:         ACTIONS.ROTATE_CW,
  KeyZ:         ACTIONS.ROTATE_CCW,
  ControlLeft:  ACTIONS.ROTATE_CCW,
  ControlRight: ACTIONS.ROTATE_CCW,
  KeyA:         ACTIONS.ROTATE_180,

  KeyC:         ACTIONS.HOLD,
  ShiftLeft:    ACTIONS.HOLD,
  ShiftRight:   ACTIONS.HOLD,

  KeyP:         ACTIONS.PAUSE,
  Escape:       ACTIONS.PAUSE
});

/** Keys whose default browser behaviour must be suppressed — spec criterion 10. */
export const SCROLL_KEYS = Object.freeze(new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'
]));

/** Held rather than tapped: these drive auto-repeat instead of firing once. */
export const HELD_ACTIONS = Object.freeze(new Set([
  ACTIONS.MOVE_LEFT, ACTIONS.MOVE_RIGHT, ACTIONS.SOFT_DROP
]));

export const lookup = (code, keymap = DEFAULT_KEYMAP) => keymap[code] ?? null;
