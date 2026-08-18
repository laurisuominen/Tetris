/**
 * What a kill is worth.
 *
 * Pure lookups over constants.js. Kept in its own module for the same reason
 * Breakout's is: the anti-cheat ceiling in supabase/functions/submit-score is
 * derived from these numbers, so they need one obvious home rather than being
 * spread through the reducer.
 */

import { POINTS, MAX_ENEMY_POINTS, STAGE_CLEAR_BONUS, RESCUE_BONUS } from './constants.js';
import { isDiving } from './enemies.js';

/**
 * Points for destroying an enemy.
 *
 * Diving is worth roughly double across the board. That is the whole risk
 * economy of the game: shooting the formation is safe and cheap, waiting for
 * something to come at you is dangerous and pays.
 */
export function pointsFor(enemy) {
  const table = POINTS[enemy.kind];
  if (!table) return 0;
  return isDiving(enemy) ? table.diving : table.formation;
}

export function stageBonus() {
  return STAGE_CLEAR_BONUS;
}

export function rescueBonus() {
  return RESCUE_BONUS;
}

/** The most any single enemy can be worth. Feeds the submit-score ceiling. */
export function maxEnemyPoints() {
  return MAX_ENEMY_POINTS;
}
