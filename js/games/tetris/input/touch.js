/**
 * Tetris touch binding.
 *
 * The button panel and gesture recognition are shared
 * (js/shared/input/touch.js); this maps them onto Tetris actions and timings.
 */

import { bindHoldButtons, bindSwipeGestures } from '../../../shared/input/touch.js';
import { ACTIONS } from '../core/game.js';
import { DAS_MS, ARR_MS } from '../core/constants.js';

const SOFT_REPEAT_MS = 40;      // cadence of held soft-drop

// Soft drop repeats immediately at its own cadence rather than serving DAS —
// waiting 170ms before the piece starts falling feels broken.
const FAST_REPEAT = new Map([[ACTIONS.SOFT_DROP, SOFT_REPEAT_MS]]);

export function createTouch(engine, getSettings = () => ({ swipeControls: true })) {
  bindHoldButtons({
    selector: '.cbtn',
    actions: ACTIONS,
    dispatch: (action) => engine.dispatch(action),
    repeatDelayMs: DAS_MS,
    repeatIntervalMs: ARR_MS,
    fastRepeat: FAST_REPEAT
  });

  bindSwipeGestures({
    selector: '#field-stack',
    enabled: () => getSettings().swipeControls !== false,
    onStepX: (direction) => {
      engine.dispatch(direction > 0 ? ACTIONS.MOVE_RIGHT : ACTIONS.MOVE_LEFT);
    },
    onStepY: () => engine.dispatch(ACTIONS.SOFT_DROP),
    onTap: () => engine.dispatch(ACTIONS.ROTATE_CW),
    onFlickDown: () => engine.dispatch(ACTIONS.HARD_DROP)
  });
}
