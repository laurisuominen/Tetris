/**
 * Scoring and pace.
 *
 * Both functions are pure and total — same arguments, same answer, no state.
 * The Edge Function's anti-cheat ceiling is derived from these two, so a change
 * here is a change there.
 */

import {
  SPEED_TABLE, APPLE_BASE_POINTS, INTERVAL_STEP_MS, INTERVAL_FLOOR_RATIO
} from './constants.js';

function tier(speed) {
  const entry = SPEED_TABLE[speed];
  if (!entry) throw new Error(`unknown speed tier: ${speed}`);
  return entry;
}

/**
 * Points for one apple.
 *
 * Scaled by tier so the slow setting is not also the high-score setting.
 * Turtle gives you more thinking time per apple, so its apples are worth less.
 */
export function applePoints(speed) {
  return APPLE_BASE_POINTS * tier(speed).multiplier;
}

/**
 * Milliseconds between moves, given how many apples have been eaten.
 *
 * Monotonically decreasing and floored. The floor is what keeps the game
 * playable at the top end: without it a long enough snake outruns human
 * reaction time and, more practically, outruns the 60Hz loop that drives it —
 * an interval below one timestep would mean more than one move per frame.
 */
export function moveIntervalMs(speed, applesEaten) {
  const { baseIntervalMs } = tier(speed);
  const floor = baseIntervalMs * INTERVAL_FLOOR_RATIO;
  return Math.max(floor, baseIntervalMs - applesEaten * INTERVAL_STEP_MS);
}
