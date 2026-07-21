/**
 * The gravity curve — spec §6.
 *
 *   dropInterval = (0.8 - (level - 1) * 0.007) ^ (level - 1) seconds
 *
 * Level 1 is ~800ms per cell and it accelerates from there, becoming sub-frame
 * at high levels — hence the caller drops multiple cells per step.
 *
 * The base goes NEGATIVE at level 115 or so, and a negative base raised to a
 * large power alternates sign, while any fractional power of it is NaN. v1 had
 * no guard here, so a sufficiently long game would have frozen the active piece
 * with an interval of NaN. Clamping the base to a small positive epsilon keeps
 * the curve finite and monotonic forever.
 */

import { MIN_DROP_INTERVAL_MS, SOFT_DROP_FACTOR } from './constants.js';

const MIN_BASE = 1e-4;

/** Milliseconds per one-cell drop at the given level. */
export function dropIntervalMs(level) {
  const base = Math.max(0.8 - (level - 1) * 0.007, MIN_BASE);
  const seconds = Math.pow(base, level - 1);
  return Math.max(seconds * 1000, MIN_DROP_INTERVAL_MS);
}

/** Soft drop is SOFT_DROP_FACTOR times faster, floored the same way. */
export function softDropIntervalMs(level) {
  return Math.max(dropIntervalMs(level) / SOFT_DROP_FACTOR, MIN_DROP_INTERVAL_MS);
}
