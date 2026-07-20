/**
 * Keyboard listeners.
 *
 * These NEVER touch game state. They push actions onto a queue that the engine
 * drains at a step boundary, which is what guarantees a keypress cannot land
 * halfway through gravity resolution.
 */

import { ACTIONS } from '../core/game.js';
import { on } from '../util/dom.js';
import { DEFAULT_KEYMAP, SCROLL_KEYS, HELD_ACTIONS, lookup } from './keymap.js';

/** Whether the event came from somewhere the user is genuinely typing. */
function isTextTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      || target.isContentEditable;
}

export function createKeyboard({ target = window, keymap = DEFAULT_KEYMAP } = {}) {
  const queue = [];
  const held = new Set();

  const offDown = on(target, 'keydown', (event) => {
    if (isTextTarget(event.target)) return;

    const action = lookup(event.code, keymap);
    if (!action) return;

    // Suppress page scroll on arrows and space — spec criterion 10. Scoped to
    // mapped keys outside form controls so the settings dialog stays usable.
    if (SCROLL_KEYS.has(event.code)) event.preventDefault();

    // The OS repeat rate is not ours; DAS/ARR handles repetition.
    if (event.repeat) return;

    if (HELD_ACTIONS.has(action)) {
      held.add(action);
      // The initial press still fires immediately; auto-repeat takes over after.
      if (action !== ACTIONS.SOFT_DROP) queue.push(action);
      return;
    }
    queue.push(action);
  });

  const offUp = on(target, 'keyup', (event) => {
    const action = lookup(event.code, keymap);
    if (action) held.delete(action);
  });

  // A window blur mid-keypress would otherwise leave a key stuck down.
  const offBlur = on(window, 'blur', () => held.clear());

  return {
    /** Takes every queued action, leaving the queue empty. */
    consumeQueue() {
      if (queue.length === 0) return [];
      return queue.splice(0, queue.length);
    },

    /** -1 left, +1 right, 0 for neither or both. */
    get horizontal() {
      const left = held.has(ACTIONS.MOVE_LEFT);
      const right = held.has(ACTIONS.MOVE_RIGHT);
      if (left === right) return 0;
      return left ? -1 : 1;
    },

    get softDrop() { return held.has(ACTIONS.SOFT_DROP); },

    destroy() {
      offDown();
      offUp();
      offBlur();
      held.clear();
      queue.length = 0;
    }
  };
}
