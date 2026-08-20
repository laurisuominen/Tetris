/**
 * The scatter/chase scheduler.
 *
 * Ghosts alternate between scattering to their corners and hunting, on a clock
 * that is per-level and entirely fixed — there is no randomness in it at all.
 * Knowing the schedule is most of what separates a good player from a bad one,
 * which is why it must be exact.
 *
 * TWO DETAILS THAT LOOK LIKE MISTAKES AND ARE NOT:
 *
 *  - From level 2 the seventh phase lasts 1/60 of a second. That is one frame.
 *    It exists purely to fire the mandatory direction reversal, and rounding it
 *    away removes a reversal the player can otherwise rely on.
 *  - The sixth phase runs 1033 or 1037 seconds — over seventeen minutes. In
 *    practice the level ends first, so the ghosts simply never scatter again.
 *
 * The frightened state is NOT part of this schedule. Eating an energizer
 * suspends the clock; when the fright ends the ghosts resume exactly where they
 * were. That is why the schedule is stored as elapsed-within-phase rather than
 * as a countdown from level start.
 */

import { phasesFor } from './levels.js';
import { MODE } from './targeting.js';

export function createModeState(level) {
  return {
    phases: phasesFor(level),
    index: 0,
    elapsedS: 0,
    /** Phases alternate starting with scatter. */
    mode: MODE.SCATTER
  };
}

const modeAt = (index) => (index % 2 === 0 ? MODE.SCATTER : MODE.CHASE);

/**
 * Advances the clock.
 *
 * @param {number} dtMs
 * @param {boolean} frozen true while frightened — the clock does not run
 * @returns {boolean} whether the mode changed this step (callers must reverse)
 */
export function stepModes(state, dtMs, frozen = false) {
  if (frozen) return false;

  const limit = state.phases[state.index];
  if (limit === Infinity) {
    state.mode = modeAt(state.index);
    return false;
  }

  state.elapsedS += dtMs / 1000;
  if (state.elapsedS < limit) return false;

  // Carry the remainder, so a one-frame phase cannot be missed by a long step.
  state.elapsedS -= limit;
  state.index = Math.min(state.index + 1, state.phases.length - 1);
  state.mode = modeAt(state.index);
  return true;
}

/** The mode a ghost should be in, ignoring frightened. */
export function currentMode(state) {
  return state.mode;
}
