/**
 * Hivebreak touch binding: held left/right arrows, and a held fire button.
 *
 * The shared panel (js/shared/input/touch.js) drives DISCRETE buttons, which
 * covers Pause and nothing else here. Steering and firing are both sustained,
 * and auto-repeating "nudge left" at an ARR cadence gives a ship that stutters
 * across the screen on a timer unrelated to the frame rate.
 *
 * So both are bound locally to held state. This is the same call Breakout made
 * for its paddle arrows and Snake made for its swipe: the shared module holds
 * what generalises, the game holds what does not.
 *
 * The arrows exist even though drag-to-move is the default, because a phone
 * player who turns dragging off still needs to fly, and a desktop player with
 * a touchscreen may prefer buttons.
 */

import { bindHoldButtons } from '../../../shared/input/touch.js';
import { on, qsa } from '../../../shared/util/dom.js';
import { ACTIONS } from '../core/game.js';

export function createTouch(engine) {
  bindHoldButtons({
    selector: '.cbtn[data-action]',
    actions: ACTIONS,
    dispatch: (action) => engine.dispatch(action),
    // No Hivebreak button carries data-hold, so these are never read.
    repeatDelayMs: 0,
    repeatIntervalMs: 0
  });

  const axis = bindHeld('.cbtn[data-axis]', (btn) => Number(btn.dataset.axis) || 0);
  const fire = bindHeld('.cbtn[data-fire]', () => 1);

  return {
    get axis() { return Math.sign(axis.total()); },
    get firing() { return fire.total() > 0; }
  };
}

/**
 * Binds a set of buttons to held state, tracked per pointer id.
 *
 * `setPointerCapture` is what makes a finger that slides off the button still
 * count as released on lift rather than sticking down forever — the failure
 * mode that leaves a ship driving into the wall, or the gun jammed on.
 */
function bindHeld(selector, valueOf) {
  const active = new Map();

  for (const btn of qsa(selector)) {
    const value = valueOf(btn);
    if (!value) continue;

    on(btn, 'pointerdown', (event) => {
      event.preventDefault();           // kill click-delay, zoom and text select
      btn.classList.add('pressed');
      btn.setPointerCapture?.(event.pointerId);
      active.set(event.pointerId, value);
    });

    const release = (event) => {
      if (!active.has(event.pointerId)) return;
      btn.classList.remove('pressed');
      active.delete(event.pointerId);
    };

    on(btn, 'pointerup', release);
    on(btn, 'pointercancel', release);
    // A mouse dragged off without capture must release too.
    on(btn, 'pointerleave', release);

    // Keyboard activation, for anyone tabbing to the button.
    on(btn, 'keydown', (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      active.set(`key-${value}`, value);
    });
    on(btn, 'keyup', () => active.delete(`key-${value}`));
  }

  // A window blur mid-press would otherwise leave the button stuck on.
  on(window, 'blur', () => active.clear());

  return {
    total() {
      let sum = 0;
      for (const v of active.values()) sum += v;
      return sum;
    }
  };
}
