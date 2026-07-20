/**
 * DAS / ARR auto-repeat — spec §10.
 *
 * Held left or right moves once immediately, waits DAS, then repeats every ARR.
 * Pure and ticked on the fixed timestep, so it is testable and cannot drift
 * against gravity.
 *
 * `tick` returns how many moves to apply this step. That can exceed 1 when ARR
 * is shorter than a timestep, which is why it returns a count rather than a
 * boolean.
 */

import { DAS_MS, ARR_MS } from '../core/constants.js';

export function createAutoRepeat({ das = DAS_MS, arr = ARR_MS } = {}) {
  let direction = 0;
  let elapsed = 0;
  let charged = false;

  return {
    /**
     * @param {number} dt  fixed timestep in ms
     * @param {number} held  -1 left, 0 none, +1 right
     * @returns {number} moves to apply, signed by direction
     */
    tick(dt, held) {
      if (held === 0) {
        direction = 0;
        elapsed = 0;
        charged = false;
        return 0;
      }

      // A direction change restarts DAS immediately — holding left then
      // tapping right should not inherit the left charge.
      if (held !== direction) {
        direction = held;
        elapsed = 0;
        charged = false;
        return 0;   // the initial move is handled by the event queue
      }

      elapsed += dt;

      if (!charged) {
        if (elapsed < das) return 0;
        elapsed -= das;
        charged = true;
        return held;
      }

      if (arr <= 0) return held * 999;   // instant ARR: caller clamps to walls

      let moves = 0;
      while (elapsed >= arr) {
        elapsed -= arr;
        moves++;
      }
      return moves * held;
    },

    reset() {
      direction = 0;
      elapsed = 0;
      charged = false;
    }
  };
}
