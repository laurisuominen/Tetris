/**
 * Key bindings.
 *
 * Keyed on KeyboardEvent.code, which is layout-independent — so WASD stays
 * physically where it is on AZERTY, where the same letters are not.
 *
 * All four directions are HELD rather than queued. Core buffers the most recent
 * request and applies it at the first tile where the turn is legal, so a key
 * tapped early is honoured rather than dropped — which is the difference between
 * a maze game that feels responsive and one that feels broken.
 */

import { ACTIONS } from '../core/game.js';

export const HELD_ACTIONS = Object.freeze({
  UP: 'CH_UP',
  LEFT: 'CH_LEFT',
  DOWN: 'CH_DOWN',
  RIGHT: 'CH_RIGHT'
});

export const DEFAULT_KEYMAP = Object.freeze({
  ArrowUp:    HELD_ACTIONS.UP,
  ArrowLeft:  HELD_ACTIONS.LEFT,
  ArrowDown:  HELD_ACTIONS.DOWN,
  ArrowRight: HELD_ACTIONS.RIGHT,
  KeyW:       HELD_ACTIONS.UP,
  KeyA:       HELD_ACTIONS.LEFT,
  KeyS:       HELD_ACTIONS.DOWN,
  KeyD:       HELD_ACTIONS.RIGHT,

  KeyP:   ACTIONS.PAUSE,
  Escape: ACTIONS.PAUSE
});

export const SCROLL_KEYS = Object.freeze(new Set([
  'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space'
]));
