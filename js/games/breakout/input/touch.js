/**
 * Breakout touch binding: a Launch button, and two paddle arrows.
 *
 * The shared panel (js/shared/input/touch.js) drives the discrete buttons, and
 * that is all it can do here: it dispatches an ACTION per press, optionally
 * auto-repeating. A paddle needs a SUSTAINED axis, and auto-repeating "nudge
 * left" at an ARR cadence gives a paddle that stutters across the screen on a
 * timer unrelated to the frame rate.
 *
 * So the arrows are bound locally to a held axis instead. This is the same call
 * Snake made about its four-way swipe, and for the same reason: the shared
 * module holds what generalises, the game holds what does not. Two callers
 * would be a pattern worth promoting; one is a guess.
 */

import { bindHoldButtons } from '../../../shared/input/touch.js';
import { on, qsa } from '../../../shared/util/dom.js';
import { ACTIONS } from '../core/game.js';

export function createTouch(engine) {
  // Discrete buttons only — Launch and anything else that is a single decision.
  bindHoldButtons({
    selector: '.cbtn[data-action]',
    actions: ACTIONS,
    dispatch: (action) => engine.dispatch(action),
    // No Breakout button carries data-hold, so these are never read.
    repeatDelayMs: 0,
    repeatIntervalMs: 0
  });

  return bindAxisButtons('.cbtn[data-axis]');
}

/**
 * Binds buttons carrying `data-axis="-1"` / `"1"` to a held value.
 *
 * Pointer events rather than touch events, so the same buttons work under a
 * mouse and a stylus without a second code path. `setPointerCapture` is what
 * makes a finger that slides off the button still count as released on lift
 * rather than sticking down forever — the failure mode that leaves a paddle
 * driving into the wall.
 */
function bindAxisButtons(selector) {
  let axis = 0;
  /** Which pointer id owns which button, so two thumbs cannot fight. */
  const active = new Map();

  const recompute = () => {
    axis = 0;
    for (const value of active.values()) axis += value;
    axis = Math.sign(axis);
  };

  for (const btn of qsa(selector)) {
    const value = Number(btn.dataset.axis);
    if (!value) continue;

    on(btn, 'pointerdown', (event) => {
      event.preventDefault();           // kill click-delay, zoom and text select
      btn.classList.add('pressed');
      btn.setPointerCapture?.(event.pointerId);
      active.set(event.pointerId, value);
      recompute();
    });

    const release = (event) => {
      if (!active.has(event.pointerId)) return;
      btn.classList.remove('pressed');
      active.delete(event.pointerId);
      recompute();
    };

    on(btn, 'pointerup', release);
    on(btn, 'pointercancel', release);
    // A pointer that leaves without capture (mouse dragged off) must release
    // too, or the paddle keeps travelling after the button is visually idle.
    on(btn, 'pointerleave', release);

    // Keyboard activation of the same button, for anyone tabbing to it.
    on(btn, 'keydown', (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      active.set(`key-${value}`, value);
      recompute();
    });
    on(btn, 'keyup', () => {
      active.delete(`key-${value}`);
      recompute();
    });
  }

  // A window blur mid-press would otherwise leave the paddle stuck on.
  on(window, 'blur', () => { active.clear(); axis = 0; });

  return {
    get axis() { return axis; }
  };
}
