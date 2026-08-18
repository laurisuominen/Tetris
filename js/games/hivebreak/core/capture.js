/**
 * The tractor beam, the captured ship, and the rescue.
 *
 * This is the mechanic the game is named around, and the rules are not
 * symmetrical — which is the point:
 *
 *   - A boss that reaches the beam row opens a cone. A ship caught in it is
 *     taken, and that COSTS A LIFE. The capture is a death, not a free ride.
 *   - The captive rides with its captor and parks below it in formation.
 *   - Shooting that boss WHILE IT DIVES frees the captive: the ship flies back
 *     and docks, and you fly a dual fighter.
 *   - Shooting it while it sits in FORMATION destroys the captive with it. No
 *     rescue, no second chance.
 *
 * That last rule is what makes the whole thing a decision rather than a bonus.
 * Without it the correct play is always "shoot the boss", and the mechanic
 * collapses into a slightly bigger enemy.
 */

import { BEAM_DURATION_MS, BEAM_HALF_W, ROWS, KIND } from './constants.js';
import { ENEMY_STATE } from './enemies.js';
import { insideBeam } from './collision.js';

/** Whether this enemy is currently projecting a beam. */
export function beamIsOpen(enemy) {
  return enemy.alive
      && enemy.kind === KIND.BOSS
      && enemy.state === ENEMY_STATE.BEAMING
      && enemy.beamMs > 0
      && enemy.beamMs < BEAM_DURATION_MS;
}

/** How far through its open beam a boss is, 0..1. Drives the render only. */
export function beamProgress(enemy) {
  if (!beamIsOpen(enemy)) return 0;
  return Math.min(enemy.beamMs / BEAM_DURATION_MS, 1);
}

/** Whether the ship is standing in this boss's beam right now. */
export function shipCaught(enemy, ship) {
  if (!beamIsOpen(enemy) || !ship.alive) return false;
  return insideBeam(enemy.x, enemy.y, BEAM_HALF_W, ship.x, ship.y, ROWS);
}

/**
 * Whether destroying this enemy should free a captive rather than kill it.
 *
 * DIVING only. See the asymmetry note above — this single condition is the
 * whole risk/reward of the mechanic.
 */
export function releasesCaptive(enemy) {
  return enemy.hasCaptive && enemy.state === ENEMY_STATE.DIVING;
}

/** Whether destroying this enemy takes the captive down with it. */
export function destroysCaptive(enemy) {
  return enemy.hasCaptive && enemy.state !== ENEMY_STATE.DIVING;
}
