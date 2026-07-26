/**
 * Tetris keyboard binding.
 *
 * The listener machinery is shared (js/shared/input/keyboard.js); this supplies
 * the Tetris action vocabulary and exposes the two derived reads the engine
 * wants — horizontal direction for DAS/ARR, and soft-drop held state.
 */

import { createKeyboard as createKeyboardBase } from '../../../shared/input/keyboard.js';
import { ACTIONS } from '../core/game.js';
import { DEFAULT_KEYMAP, SCROLL_KEYS, HELD_ACTIONS } from './keymap.js';

// Soft drop is continuous: gravity applies it every step while held, so
// queueing it on the initial press too would double-apply the first cell.
const SUPPRESS_INITIAL = Object.freeze(new Set([ACTIONS.SOFT_DROP]));

export function createKeyboard({ target = window, keymap = DEFAULT_KEYMAP } = {}) {
  const base = createKeyboardBase({
    target,
    keymap,
    scrollKeys: SCROLL_KEYS,
    heldActions: HELD_ACTIONS,
    suppressInitial: SUPPRESS_INITIAL,
    axis: { negative: ACTIONS.MOVE_LEFT, positive: ACTIONS.MOVE_RIGHT }
  });

  return {
    consumeQueue: base.consumeQueue,
    get horizontal() { return base.horizontal; },
    get softDrop() { return base.isHeld(ACTIONS.SOFT_DROP); },
    destroy: base.destroy
  };
}
