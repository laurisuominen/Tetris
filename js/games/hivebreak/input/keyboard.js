/**
 * Hivebreak keyboard binding.
 *
 * The listener machinery is shared (js/shared/input/keyboard.js); this supplies
 * the Hivebreak vocabulary. No shared code needed changing for a FOURTH game:
 * `heldActions`, `suppressInitial` and `axis` were already there for Tetris's
 * DAS and Breakout's paddle, and `isHeld` — which is all a held trigger needs —
 * was already on the returned object.
 */

import { createKeyboard as createKeyboardBase } from '../../../shared/input/keyboard.js';
import { DEFAULT_KEYMAP, SCROLL_KEYS, HELD_ACTIONS } from './keymap.js';

const HELD = Object.freeze(new Set([
  HELD_ACTIONS.LEFT, HELD_ACTIONS.RIGHT, HELD_ACTIONS.FIRE
]));

export function createKeyboard({ target = window, keymap = DEFAULT_KEYMAP } = {}) {
  const base = createKeyboardBase({
    target,
    keymap,
    scrollKeys: SCROLL_KEYS,
    heldActions: HELD,
    suppressInitial: HELD,
    axis: { negative: HELD_ACTIONS.LEFT, positive: HELD_ACTIONS.RIGHT }
  });

  return {
    consumeQueue: base.consumeQueue,
    /** -1, 0 or +1. Both keys down cancel out, which is what a player means. */
    get axis() { return base.horizontal; },
    get firing() { return base.isHeld(HELD_ACTIONS.FIRE); },
    destroy: base.destroy
  };
}
