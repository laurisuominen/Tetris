/**
 * Keyboard listeners.
 *
 * These NEVER touch game state. They push actions onto a queue that the engine
 * drains at a step boundary, which is what guarantees a keypress cannot land
 * halfway through gravity resolution.
 *
 * Nothing here knows any game's action vocabulary — the keymap and the action
 * sets are supplied by the caller, so a game's own thin wrapper binds them
 * (see js/games/tetris/input/keyboard.js).
 */

import { on } from '../util/dom.js';

/**
 * Whether the event came from somewhere the user is genuinely typing.
 *
 * Exported because the keyboard module is not the only thing that listens for
 * keys. Any raw window-level shortcut needs the same test, and a shortcut that
 * skips it will fire while the player is typing into a field — which is how
 * Enter came to discard a high score instead of saving it. One definition of
 * "is typing" for the whole codebase; two would eventually disagree.
 */
export function isTextTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      || target.isContentEditable;
}

/**
 * @param {object} options
 * @param {EventTarget} options.target  where to listen (default window)
 * @param {Object<string,string>} options.keymap  KeyboardEvent.code -> action
 * @param {Set<string>} options.scrollKeys  codes whose default scroll is suppressed
 * @param {Set<string>} options.heldActions  actions tracked while the key is down
 * @param {Set<string>} options.suppressInitial
 *        held actions that must NOT queue on the initial press, because a
 *        continuous mechanic (auto-repeat, soft drop) already owns them
 * @param {{negative:string, positive:string}|null} options.axis
 *        pair of held actions surfaced through the `horizontal` getter
 */
export function createKeyboard({
  target = window,
  keymap,
  scrollKeys = new Set(),
  heldActions = new Set(),
  suppressInitial = new Set(),
  axis = null
} = {}) {
  if (!keymap) throw new Error('createKeyboard requires a keymap');

  const queue = [];
  const held = new Set();
  const lookup = (code) => keymap[code] ?? null;

  const offDown = on(target, 'keydown', (event) => {
    if (isTextTarget(event.target)) return;

    const action = lookup(event.code);
    if (!action) return;

    // Suppress page scroll on arrows and space — spec criterion 10. Scoped to
    // mapped keys outside form controls so the settings dialog stays usable.
    if (scrollKeys.has(event.code)) event.preventDefault();

    // The OS repeat rate is not ours; DAS/ARR handles repetition.
    if (event.repeat) return;

    if (heldActions.has(action)) {
      held.add(action);
      // The initial press still fires immediately; auto-repeat takes over after.
      if (!suppressInitial.has(action)) queue.push(action);
      return;
    }
    queue.push(action);
  });

  const offUp = on(target, 'keyup', (event) => {
    const action = lookup(event.code);
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

    isHeld(action) { return held.has(action); },

    /** -1 negative, +1 positive, 0 for neither or both. Requires `axis`. */
    get horizontal() {
      if (!axis) return 0;
      const negative = held.has(axis.negative);
      const positive = held.has(axis.positive);
      if (negative === positive) return 0;
      return negative ? -1 : 1;
    },

    destroy() {
      offDown();
      offUp();
      offBlur();
      held.clear();
      queue.length = 0;
    }
  };
}
