/**
 * Scoring and the ball's speed schedule.
 *
 * Pure arithmetic, split out so the anti-cheat derivation in
 * supabase/functions/submit-score/index.ts has one file to point at.
 */

import {
  ROW_POINTS, SCORE_MULTIPLIER_CAP, SPEED_TABLE, SPEEDUP_FACTOR,
  LEVEL_SPEED_FACTOR, MAX_BALL_SPEED
} from './constants.js';

/**
 * The score multiplier for a level: the level number, capped.
 *
 * Level 1 multiplies by 1, so a cleared first screen is exactly 448 points —
 * the documented per-screen total of the 1976 game. That is not a coincidence
 * worth losing.
 */
export function scoreMultiplier(level) {
  return Math.min(level, SCORE_MULTIPLIER_CAP);
}

/** What a brick in `row` is worth at `level`. */
export function brickPoints(row, level) {
  const base = ROW_POINTS[row];
  if (base === undefined) throw new Error(`no point value for brick row ${row}`);
  return base * scoreMultiplier(level);
}

/**
 * Ball speed at the start of a level, before any in-screen speed-ups.
 *
 * Throws rather than defaulting on an unknown tier, per the house rule: a
 * silently wrong ball speed is a game that plays differently for no visible
 * reason.
 */
export function levelStartSpeed(speed, level) {
  const tier = SPEED_TABLE[speed];
  if (!tier) throw new Error(`unknown speed tier: ${speed}`);
  const raw = tier.baseSpeed * LEVEL_SPEED_FACTOR ** (level - 1);
  return Math.min(raw, MAX_BALL_SPEED);
}

/** One classic speed-up step, clamped to the cap the solver is sized for. */
export function speedUp(current) {
  return Math.min(current * SPEEDUP_FACTOR, MAX_BALL_SPEED);
}
