/**
 * What things are worth.
 *
 * Pure lookups. Kept apart from the reducer for the reason Breakout's and
 * Hivebreak's are: supabase/functions/submit-score derives its ceiling from
 * these numbers, so they need one obvious home.
 */

import {
  DOT_POINTS, ENERGIZER_POINTS, GHOST_CHAIN, MAX_FRUIT_POINTS,
  TOTAL_DOTS, TOTAL_ENERGIZERS
} from './constants.js';
import { fruitFor } from './levels.js';

export const dotPoints = () => DOT_POINTS;
export const energizerPoints = () => ENERGIZER_POINTS;

/**
 * The nth ghost eaten on ONE energizer: 200, 400, 800, 1600.
 * The chain resets with every energizer, which is why eating all four on each
 * of them is worth 12,000 a board and is most of a good score.
 */
export function ghostPoints(chainIndex) {
  return GHOST_CHAIN[Math.min(Math.max(chainIndex, 0), GHOST_CHAIN.length - 1)];
}

export function fruitPoints(level) {
  return fruitFor(level).points;
}

/** Every pellet on a board: 240 x 10 + 4 x 50 = 2,600. */
export function boardPelletPoints() {
  return TOTAL_DOTS * DOT_POINTS + TOTAL_ENERGIZERS * ENERGIZER_POINTS;
}

/**
 * The most a single board can yield. Feeds the anti-cheat cap, and the
 * derivation is repeated in the Edge Function beside the number.
 *
 *   pellets                          2,600
 *   4 energizers x full 3,000 chain 12,000
 *   2 fruit at the 5,000 maximum    10,000
 *                                   ------
 *                                   24,600
 */
export function maxBoardPoints() {
  const chain = GHOST_CHAIN.reduce((a, b) => a + b, 0);
  return boardPelletPoints() + TOTAL_ENERGIZERS * chain + 2 * MAX_FRUIT_POINTS;
}
