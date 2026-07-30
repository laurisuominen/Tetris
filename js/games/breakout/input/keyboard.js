/**
 * Breakout keyboard binding.
 *
 * The listener machinery is shared (js/shared/input/keyboard.js); this supplies
 * the Breakout vocabulary. No shared code needed changing for a third game: the
 * `heldActions` / `suppressInitial` / `axis` options were already there for
 * Tetris's DAS, and a paddle axis is exactly what they express.
 *
 * The two direction actions are held-only. They go in `suppressInitial` as well
 * as `heldActions` so the initial press does not also land on the action queue —
 * core has no PADDLE_LEFT action to apply, it reads the axis instead, and a
 * queued name nothing consumes is a silent leak.
 */

import { createKeyboard as createKeyboardBase } from '../../../shared/input/keyboard.js';
import { DEFAULT_KEYMAP, SCROLL_KEYS, AXIS_ACTIONS } from './keymap.js';

const HELD = Object.freeze(new Set([AXIS_ACTIONS.LEFT, AXIS_ACTIONS.RIGHT]));

export function createKeyboard({ target = window, keymap = DEFAULT_KEYMAP } = {}) {
  const base = createKeyboardBase({
    target,
    keymap,
    scrollKeys: SCROLL_KEYS,
    heldActions: HELD,
    suppressInitial: HELD,
    axis: { negative: AXIS_ACTIONS.LEFT, positive: AXIS_ACTIONS.RIGHT }
  });

  return {
    consumeQueue: base.consumeQueue,
    /** -1, 0 or +1. Both keys down cancel out, which is what a player means. */
    get axis() { return base.horizontal; },
    destroy: base.destroy
  };
}
