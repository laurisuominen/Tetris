/**
 * When each ghost leaves the house.
 *
 * The rule that ships in most clones — "let them out on a timer" — is why those
 * clones feel wrong. In the arcade, release is driven by how many DOTS the
 * player has eaten, which means a cautious player faces the whole quartet early
 * and a fast one outruns them. It is the game's difficulty dial and the player
 * turns it without knowing.
 *
 * There are three mechanisms and they interact:
 *
 *  1. PERSONAL COUNTERS. Each ghost has a dot limit for the level. Only the
 *     counter of the most-preferred ghost STILL INSIDE advances — Pinky, then
 *     Inky, then Clyde — so the limits are cumulative in effect, not parallel.
 *  2. THE GLOBAL COUNTER. After a death the personal counters are abandoned and
 *     a single shared counter takes over with its own thresholds. It is switched
 *     off again the moment Clyde's threshold is reached, and personal counters
 *     resume. Without this a player who dies late in a level would face an empty
 *     house for the rest of it.
 *  3. THE IDLE FAILSAFE. If no dot is eaten for four seconds (three from level
 *     5) the most-preferred waiting ghost leaves anyway. This is what stops a
 *     player parking in a corner forever.
 */

import { GHOST } from './constants.js';
import { houseLimitsFor, releaseTimeoutFor } from './levels.js';
import { GLOBAL_RELEASE } from './constants.js';

/** Preference order for both the counter and the failsafe. Blinky is never in. */
const PREFERENCE = [GHOST.PINKY, GHOST.INKY, GHOST.CLYDE];

export function createHouse(level) {
  return {
    limits: houseLimitsFor(level),
    counters: [0, 0, 0, 0],
    /** After a death the personal counters are abandoned for this. */
    useGlobal: false,
    globalCount: 0,
    idleMs: 0,
    timeoutMs: releaseTimeoutFor(level)
  };
}

/** New level: personal counters, fresh limits. */
export function resetHouse(house, level) {
  house.limits = houseLimitsFor(level);
  house.counters = [0, 0, 0, 0];
  house.useGlobal = false;
  house.globalCount = 0;
  house.idleMs = 0;
  house.timeoutMs = releaseTimeoutFor(level);
}

/** A life was lost: switch to the global counter until Clyde's mark. */
export function onDeath(house) {
  house.useGlobal = true;
  house.globalCount = 0;
  house.idleMs = 0;
}

/**
 * A dot was eaten.
 *
 * @param {(ghost:number)=>boolean} isInHouse tells us who is still waiting
 */
export function onDotEaten(house, isInHouse) {
  house.idleMs = 0;

  if (house.useGlobal) {
    house.globalCount += 1;
    // Clyde's threshold retires the global counter for the rest of the level.
    if (house.globalCount >= GLOBAL_RELEASE[GHOST.CLYDE] && !isInHouse(GHOST.CLYDE)) {
      house.useGlobal = false;
    }
    return;
  }

  // Only the most-preferred ghost still inside advances.
  for (const ghost of PREFERENCE) {
    if (isInHouse(ghost)) {
      house.counters[ghost] += 1;
      return;
    }
  }
}

/** No dot for a while: the failsafe arms. */
export function stepIdle(house, dtMs) {
  house.idleMs += dtMs;
}

/**
 * Should this ghost leave right now?
 *
 * @param {number} ghost
 * @param {(ghost:number)=>boolean} isInHouse
 */
export function shouldRelease(house, ghost, isInHouse) {
  if (ghost === GHOST.BLINKY) return true;   // never in the house to begin with

  // The failsafe outranks everything, but only frees the FIRST waiting ghost.
  if (house.idleMs >= house.timeoutMs) {
    for (const g of PREFERENCE) {
      if (isInHouse(g)) return g === ghost;
    }
    return false;
  }

  if (house.useGlobal) return house.globalCount >= GLOBAL_RELEASE[ghost];
  return house.counters[ghost] >= house.limits[ghost];
}

/** Clears the failsafe once a ghost has actually gone. */
export function noteRelease(house) {
  house.idleMs = 0;
}
