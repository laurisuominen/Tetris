/**
 * Chomp touch binding: a swipe anywhere on the board, plus an on-screen D-pad.
 *
 * The swipe primitive is shared (js/shared/input/touch.js) — Snake established
 * it and it generalises cleanly to four directions. What does NOT generalise is
 * what a direction MEANS here: Snake turns immediately, Chomp buffers the
 * request until the player reaches a tile where the turn is legal. That
 * buffering lives in core, so this module only has to report the last direction
 * asked for.
 *
 * A D-pad as well as swipes, because a maze needs precise single turns and a
 * swipe is a poor way to ask for one turn at a junction you are already on.
 */

import { bindSwipeGestures, bindHoldButtons } from '../../../shared/input/touch.js';
import { on, qsa } from '../../../shared/util/dom.js';
import { ACTIONS } from '../core/game.js';
import { UP, LEFT, DOWN, RIGHT } from '../core/constants.js';

export function createTouch(engine, { fieldSelector = '#field-stack' } = {}) {
  let dir = null;

  // Discrete buttons: Pause and anything else that is one decision.
  bindHoldButtons({
    selector: '.cbtn[data-action]',
    actions: ACTIONS,
    dispatch: (action) => engine.dispatch(action),
    repeatDelayMs: 0,
    repeatIntervalMs: 0
  });

  bindSwipeGestures({
    selector: fieldSelector,
    onStepX(step) { dir = step > 0 ? RIGHT : LEFT; },
    onStepY(step) { dir = step > 0 ? DOWN : UP; }
  });

  const NAMES = { up: UP, left: LEFT, down: DOWN, right: RIGHT };

  for (const btn of qsa('.cbtn[data-dir]')) {
    const value = NAMES[btn.dataset.dir];
    if (value === undefined) continue;

    on(btn, 'pointerdown', (event) => {
      event.preventDefault();          // kill click-delay, zoom and text select
      btn.classList.add('pressed');
      btn.setPointerCapture?.(event.pointerId);
      dir = value;
    });

    const release = () => btn.classList.remove('pressed');
    on(btn, 'pointerup', release);
    on(btn, 'pointercancel', release);
    on(btn, 'pointerleave', release);

    on(btn, 'keydown', (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      dir = value;
    });
  }

  return {
    /**
     * The last direction asked for, then CLEARED.
     *
     * Read-once, unlike the held axes in Breakout and Hivebreak. A swipe is a
     * single request, and leaving it latched would keep re-asking for the same
     * turn at every junction for the rest of the level.
     */
    get dir() {
      const d = dir;
      dir = null;
      return d;
    }
  };
}
