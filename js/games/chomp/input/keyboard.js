/**
 * Chomp keyboard binding.
 *
 * The listener machinery is shared; this supplies the Chomp vocabulary. No
 * shared code needed changing for a FIFTH game — `heldActions`,
 * `suppressInitial` and `isHeld` were already there.
 *
 * `dir` reports the MOST RECENTLY PRESSED direction still held, not a fixed
 * priority order. Priority would mean that holding Left while tapping Up does
 * nothing, which is exactly the input a player makes when turning a corner.
 */

import { createKeyboard as createKeyboardBase } from '../../../shared/input/keyboard.js';
import { DEFAULT_KEYMAP, SCROLL_KEYS, HELD_ACTIONS } from './keymap.js';
import { UP, LEFT, DOWN, RIGHT } from '../core/constants.js';
import { on } from '../../../shared/util/dom.js';

const HELD = Object.freeze(new Set(Object.values(HELD_ACTIONS)));

const KEY_TO_DIR = Object.freeze({
  [HELD_ACTIONS.UP]: UP,
  [HELD_ACTIONS.LEFT]: LEFT,
  [HELD_ACTIONS.DOWN]: DOWN,
  [HELD_ACTIONS.RIGHT]: RIGHT
});

export function createKeyboard({ target = window, keymap = DEFAULT_KEYMAP } = {}) {
  const base = createKeyboardBase({
    target,
    keymap,
    scrollKeys: SCROLL_KEYS,
    heldActions: HELD,
    suppressInitial: HELD
  });

  let latest = null;

  // The shared module tracks WHICH actions are held but not the order they
  // arrived in, so the recency is tracked here rather than by changing it.
  const offDown = on(target, 'keydown', (event) => {
    const action = keymap[event.code];
    const dir = KEY_TO_DIR[action];
    if (dir !== undefined) latest = dir;
  });

  return {
    consumeQueue: base.consumeQueue,

    /** The direction the player is asking for, or null. */
    get dir() {
      if (latest !== null) {
        const action = Object.keys(KEY_TO_DIR).find((k) => KEY_TO_DIR[k] === latest);
        if (base.isHeld(action)) return latest;
        latest = null;
      }
      // Fall back to any direction still held.
      for (const [action, dir] of Object.entries(KEY_TO_DIR)) {
        if (base.isHeld(action)) return dir;
      }
      return null;
    },

    destroy() {
      offDown();
      base.destroy();
    }
  };
}
