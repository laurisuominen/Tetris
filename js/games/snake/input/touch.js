/**
 * Snake touch binding: a four-way D-pad plus swipe-to-steer.
 *
 * The button panel is shared (js/shared/input/touch.js). The gesture is not,
 * and that is deliberate rather than an oversight.
 *
 * bindSwipeGestures in shared/ recognises Tetris's vocabulary: drag sideways to
 * step a piece, drag down to soft drop, tap to rotate, flick down to hard drop.
 * It has no concept of "up", because Tetris has no up. Snake's gesture is a
 * different shape entirely — one discrete turn in any of four directions, and
 * a drag that can keep turning as it goes, so a finger can trace a path.
 * Reshaping the shared recogniser to cover both would leave a function whose
 * options only make sense two at a time.
 *
 * If a third game wants four-way swipes, that is the moment to promote this.
 * Two callers is a pattern; one is a guess.
 */

import { bindHoldButtons } from '../../../shared/input/touch.js';
import { on, qs } from '../../../shared/util/dom.js';
import { ACTIONS } from '../core/game.js';

/** Finger travel before a drag counts as a turn. */
const SWIPE_STEP_PX = 22;

export function createTouch(engine, getSettings = () => ({ swipeControls: true })) {
  bindHoldButtons({
    selector: '.cbtn',
    actions: ACTIONS,
    dispatch: (action) => engine.dispatch(action),
    // No Snake button carries data-hold, so these are never read. A held
    // direction must not stream turns: the queue is two deep and would fill
    // with duplicates of a decision the player made once.
    repeatDelayMs: 0,
    repeatIntervalMs: 0
  });

  bindFourWaySwipe({
    selector: '#field-stack',
    enabled: () => getSettings().swipeControls !== false,
    onDirection: (direction) => engine.dispatch(direction)
  });
}

/**
 * One turn per SWIPE_STEP_PX of travel, in whichever direction dominates.
 *
 * Re-anchoring after each turn is what lets a single continuous drag steer the
 * snake round a corner, rather than one swipe buying exactly one turn.
 */
function bindFourWaySwipe({ selector, enabled, onDirection }) {
  const field = qs(selector);
  if (!field) return;

  let anchorX = 0;
  let anchorY = 0;
  let active = false;

  on(field, 'touchstart', (event) => {
    if (!enabled()) return;
    event.preventDefault();
    const touch = event.changedTouches[0];
    anchorX = touch.clientX;
    anchorY = touch.clientY;
    active = true;
  }, { passive: false });

  on(field, 'touchmove', (event) => {
    if (!active || !enabled()) return;
    event.preventDefault();

    const touch = event.changedTouches[0];
    const dx = touch.clientX - anchorX;
    const dy = touch.clientY - anchorY;
    if (Math.abs(dx) < SWIPE_STEP_PX && Math.abs(dy) < SWIPE_STEP_PX) return;

    // Dominant axis wins. A diagonal drag has to resolve to one turn; sending
    // both would queue a turn the player did not ask for.
    if (Math.abs(dx) > Math.abs(dy)) {
      onDirection(dx > 0 ? ACTIONS.RIGHT : ACTIONS.LEFT);
    } else {
      onDirection(dy > 0 ? ACTIONS.DOWN : ACTIONS.UP);
    }

    anchorX = touch.clientX;
    anchorY = touch.clientY;
  }, { passive: false });

  const end = () => { active = false; };
  on(field, 'touchend', end);
  on(field, 'touchcancel', end);
}
