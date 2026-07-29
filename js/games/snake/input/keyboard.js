/**
 * Snake keyboard binding.
 *
 * The listener machinery is shared (js/shared/input/keyboard.js); this supplies
 * the Snake action vocabulary.
 *
 * Nothing is registered as a held action and there is no axis. A turn is a
 * discrete decision, not a sustained one: holding Left should not enqueue Left
 * fifty times a second, and the shared module already ignores the OS key-repeat
 * events that would otherwise do exactly that.
 */

import { createKeyboard as createKeyboardBase } from '../../../shared/input/keyboard.js';
import { DEFAULT_KEYMAP, SCROLL_KEYS } from './keymap.js';

export function createKeyboard({ target = window, keymap = DEFAULT_KEYMAP } = {}) {
  const base = createKeyboardBase({
    target,
    keymap,
    scrollKeys: SCROLL_KEYS
  });

  return {
    consumeQueue: base.consumeQueue,
    destroy: base.destroy
  };
}
