/**
 * Fixed-timestep game loop.
 *
 * The one rule that keeps everything in sync: game logic advances ONLY here,
 * only in whole `timestep` increments. Nothing below this module reads a
 * clock. Cosmetic effects run on wall time in the render layer, where they
 * cannot affect state.
 *
 * The timestep is a parameter rather than an import so this is shared across
 * games — each game owns its own tick rate.
 */

import { realClock } from './clock.js';

/** Beyond this, a delta is assumed to be a stall rather than real elapsed time. */
const MAX_DELTA_MS = 250;

/**
 * Sub-steps allowed per frame before the surplus is discarded.
 *
 * Discarding is deliberate. Without a cap, a slow frame queues more steps,
 * which makes the next frame slower still — the classic spiral of death. Losing
 * a few frames' worth of gravity is strictly better than locking up the tab.
 *
 * It also means a heavily lagged session diverges slightly from a smooth one.
 * That is the correct trade, and it is why the determinism test feeds deltas
 * below the cap. Do not "fix" this discard.
 */
const MAX_STEPS_PER_FRAME = 8;

export function createLoop({ clock = realClock, timestep, step, render }) {
  if (!(timestep > 0)) {
    throw new Error('createLoop requires a positive timestep in milliseconds');
  }

  let running = false;
  let rafId = null;
  let last = 0;
  let accumulator = 0;

  function frame(now) {
    if (!running) return;

    const delta = Math.min(now - last, MAX_DELTA_MS);
    last = now;
    accumulator += delta;

    let steps = 0;
    while (accumulator >= timestep && steps < MAX_STEPS_PER_FRAME) {
      accumulator -= timestep;
      steps++;
      step(timestep);
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;

    // alpha is for cosmetic interpolation only. Piece positions are discrete
    // grid cells; interpolating them would produce visible ghosting.
    render(accumulator / timestep);

    rafId = clock.raf(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = clock.now();
      accumulator = 0;
      rafId = clock.raf(frame);
    },

    stop() {
      running = false;
      if (rafId !== null) clock.cancel(rafId);
      rafId = null;
    },

    get running() { return running; }
  };
}
