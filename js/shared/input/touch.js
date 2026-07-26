/**
 * Touch input primitives: an on-screen control panel and canvas swipe gestures.
 *
 * Both are decoupled from game state — like the keyboard module, they only
 * report intent to the caller. Movement buttons auto-repeat on hold with a
 * DAS/ARR feel, implemented locally with timers so this module needs no access
 * to engine internals.
 *
 * Listeners use touchstart/touchend with preventDefault so a button press feels
 * instant (no 300ms click delay) and never triggers double-tap zoom, text
 * selection, or pull-to-refresh. Mouse and keyboard fallbacks keep the same
 * buttons usable on desktop and with assistive tech.
 *
 * No game vocabulary here: actions are opaque strings and every gesture is a
 * callback. See js/games/tetris/input/touch.js for the Tetris binding.
 */

import { on, qs, qsa } from '../util/dom.js';

/* -------------------------------------------------------------------------- */

/**
 * Binds an on-screen button panel.
 *
 * Buttons are found by `selector` and carry their action in `data-action`.
 * `data-hold` opts a button into auto-repeat.
 *
 * @param {object} options
 * @param {string} options.selector           CSS selector for the buttons
 * @param {Object<string,string>} options.actions  data-action value -> action
 * @param {(action:string)=>void} options.dispatch
 * @param {number} options.repeatDelayMs      DAS: wait before repeating
 * @param {number} options.repeatIntervalMs   ARR: cadence once repeating
 * @param {Map<string,number>} options.fastRepeat
 *        actions that repeat immediately at their own cadence with no DAS
 *        (soft drop, typically)
 */
export function bindHoldButtons({
  selector = '.cbtn',
  actions,
  dispatch,
  repeatDelayMs,
  repeatIntervalMs,
  fastRepeat = new Map()
}) {
  for (const btn of qsa(selector)) {
    const action = actions[btn.dataset.action];
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
      dispatch(action);
      if (!repeating) return;

      const fast = fastRepeat.get(action);
      if (fast !== undefined) {
        arrTimer = setInterval(() => dispatch(action), fast);
      } else {
        // Move: hold DAS, then repeat at ARR — matching the keyboard.
        dasTimer = setTimeout(() => {
          arrTimer = setInterval(() => dispatch(action), repeatIntervalMs);
        }, repeatDelayMs);
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
      if (e.detail === 0) dispatch(action);
    });
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Recognises drag-to-step, tap and downward-flick gestures on an element.
 *
 * Travel is quantised into discrete steps rather than reported as raw deltas,
 * because the games consuming this move on a grid.
 *
 * @param {object} options
 * @param {string} options.selector      element to bind (no-op if absent)
 * @param {()=>boolean} options.enabled
 * @param {(direction:-1|1)=>void} options.onStepX  one horizontal step
 * @param {()=>void} options.onStepY                one downward step
 * @param {()=>void} options.onTap
 * @param {()=>void} options.onFlickDown
 */
export function bindSwipeGestures({
  selector,
  enabled = () => true,
  stepPx = 24,          // travel per step
  tapMaxPx = 12,        // movement below this counts as a tap
  tapMaxMs = 220,       // and faster than this
  flickMinPx = 60,      // downward travel for a flick
  flickMaxMs = 250,
  onStepX = () => {},
  onStepY = () => {},
  onTap = () => {},
  onFlickDown = () => {}
}) {
  const field = qs(selector);
  if (!field) return;

  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let startTime = 0;
  let active = false;

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

    // Quantise horizontal travel into one step per stepPx of movement.
    let dx = t.clientX - lastX;
    while (dx >= stepPx)  { onStepX(1);  lastX += stepPx; dx -= stepPx; }
    while (dx <= -stepPx) { onStepX(-1); lastX -= stepPx; dx += stepPx; }

    // Sustained downward drag = one step per stepPx.
    let dy = t.clientY - lastY;
    while (dy >= stepPx) { onStepY(); lastY += stepPx; dy -= stepPx; }
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

    if (moved < tapMaxPx && elapsed < tapMaxMs) {
      onTap();
    } else if (totalY > flickMinPx && elapsed < flickMaxMs
               && Math.abs(totalX) < totalY) {
      onFlickDown();
    }
  });
}
