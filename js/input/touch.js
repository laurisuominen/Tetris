/**
 * Touch input: an on-screen control panel plus optional canvas swipe gestures.
 *
 * Both are decoupled from game state — like the keyboard module, they only
 * dispatch actions to the engine. Movement buttons auto-repeat on hold using
 * the same DAS/ARR feel as the keyboard, implemented locally with timers so
 * this module needs no access to engine internals.
 *
 * Listeners use touchstart/touchend with preventDefault so a button press feels
 * instant (no 300ms click delay) and never triggers double-tap zoom, text
 * selection, or pull-to-refresh. Mouse and keyboard fallbacks keep the same
 * buttons usable on desktop and with assistive tech.
 */

import { ACTIONS } from '../core/game.js';
import { DAS_MS, ARR_MS } from '../core/constants.js';
import { on, qs, qsa } from '../util/dom.js';

const SOFT_REPEAT_MS = 40;      // cadence of held soft-drop
const SWIPE_STEP_PX = 24;       // horizontal travel per column moved
const TAP_MAX_PX = 12;          // movement below this counts as a tap
const TAP_MAX_MS = 220;         // and faster than this
const FLICK_MIN_PX = 60;        // downward travel for a hard-drop flick
const FLICK_MAX_MS = 250;

export function createTouch(engine, getSettings = () => ({ swipeControls: true })) {
  bindButtons(engine);
  bindSwipe(engine, getSettings);
}

/* -------------------------------------------------------------------------- */

function bindButtons(engine) {
  for (const btn of qsa('.cbtn')) {
    const action = ACTIONS[btn.dataset.action];
    if (!action) continue;
    const repeating = btn.hasAttribute('data-hold');

    let dasTimer = null;
    let arrTimer = null;

    const stopRepeat = () => {
      clearTimeout(dasTimer);
      clearInterval(arrTimer);
      dasTimer = arrTimer = null;
    };

    const press = () => {
      engine.dispatch(action);
      if (!repeating) return;

      if (action === ACTIONS.SOFT_DROP) {
        arrTimer = setInterval(() => engine.dispatch(action), SOFT_REPEAT_MS);
      } else {
        // Move: hold DAS, then repeat at ARR — matching the keyboard.
        dasTimer = setTimeout(() => {
          arrTimer = setInterval(() => engine.dispatch(action), ARR_MS);
        }, DAS_MS);
      }
    };

    const down = (e) => {
      e.preventDefault();          // kill click-delay, zoom, and synth mouse
      btn.classList.add('pressed');
      press();
    };
    const up = () => {
      btn.classList.remove('pressed');
      stopRepeat();
    };

    on(btn, 'touchstart', down, { passive: false });
    on(btn, 'touchend', up);
    on(btn, 'touchcancel', up);

    // Mouse fallback for desktop testing. Touch already called preventDefault,
    // so these do not double-fire on touch devices.
    on(btn, 'mousedown', down);
    on(btn, 'mouseup', up);
    on(btn, 'mouseleave', up);

    // Keyboard / assistive activation: fire once, no repeat (detail 0 == key).
    on(btn, 'click', (e) => {
      if (e.detail === 0) engine.dispatch(action);
    });
  }
}

/* -------------------------------------------------------------------------- */

function bindSwipe(engine, getSettings) {
  const field = qs('#field-stack');
  if (!field) return;

  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let startTime = 0;
  let active = false;

  const enabled = () => getSettings().swipeControls !== false;

  on(field, 'touchstart', (e) => {
    if (!enabled()) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    startX = lastX = t.clientX;
    startY = lastY = t.clientY;
    startTime = performance.now();
    active = true;
  }, { passive: false });

  on(field, 'touchmove', (e) => {
    if (!active || !enabled()) return;
    e.preventDefault();
    const t = e.changedTouches[0];

    // Quantise horizontal travel into one move per column of movement.
    let dx = t.clientX - lastX;
    while (dx >= SWIPE_STEP_PX)  { engine.dispatch(ACTIONS.MOVE_RIGHT); lastX += SWIPE_STEP_PX; dx -= SWIPE_STEP_PX; }
    while (dx <= -SWIPE_STEP_PX) { engine.dispatch(ACTIONS.MOVE_LEFT);  lastX -= SWIPE_STEP_PX; dx += SWIPE_STEP_PX; }

    // Sustained downward drag = soft drop, one cell per step.
    let dy = t.clientY - lastY;
    while (dy >= SWIPE_STEP_PX) { engine.dispatch(ACTIONS.SOFT_DROP); lastY += SWIPE_STEP_PX; dy -= SWIPE_STEP_PX; }
  }, { passive: false });

  on(field, 'touchend', (e) => {
    if (!active) return;
    active = false;
    if (!enabled()) return;

    const t = e.changedTouches[0];
    const totalX = t.clientX - startX;
    const totalY = t.clientY - startY;
    const elapsed = performance.now() - startTime;
    const moved = Math.hypot(totalX, totalY);

    if (moved < TAP_MAX_PX && elapsed < TAP_MAX_MS) {
      engine.dispatch(ACTIONS.ROTATE_CW);              // tap to rotate
    } else if (totalY > FLICK_MIN_PX && elapsed < FLICK_MAX_MS
               && Math.abs(totalX) < totalY) {
      engine.dispatch(ACTIONS.HARD_DROP);              // fast down-flick to slam
    }
  });
}
