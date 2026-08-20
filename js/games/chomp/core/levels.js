/**
 * Per-level lookups.
 *
 * Every table in constants.js is indexed either by level directly (clamped to
 * its last row) or by a level BAND. Doing that lookup in one place stops the
 * off-by-one that otherwise appears once per table: the tables are written
 * level-1-first, so level N is index N-1.
 */

import {
  FRUIT_TABLE, FRIGHT_TABLE, ELROY_TABLE, SPEED_BANDS, HOUSE_LIMITS,
  RELEASE_TIMEOUT_MS, RELEASE_TIMEOUT_MS_L5, PHASE_TABLE
} from './constants.js';

/** Row for a level from a table written level-1-first, clamped at the end. */
function rowFor(table, level) {
  const i = Math.min(Math.max(level, 1), table.length) - 1;
  return table[i];
}

/** Value from a table keyed by "levels up to N". */
function bandFor(table, level) {
  const keys = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  for (const k of keys) if (level <= k) return table[k];
  return table[keys[keys.length - 1]];
}

/** @returns {{name:string, points:number}} */
export function fruitFor(level) {
  const [name, points] = rowFor(FRUIT_TABLE, level);
  return { name, points };
}

/** @returns {{seconds:number, flashes:number}} zero seconds = never turns blue */
export function frightFor(level) {
  const [seconds, flashes] = rowFor(FRIGHT_TABLE, level);
  return { seconds, flashes };
}

/** Dots REMAINING at which Blinky enters each Cruise Elroy stage. */
export function elroyFor(level) {
  const [one, two] = rowFor(ELROY_TABLE, level);
  return { one, two };
}

/** @returns {{player,playerDots,ghost,fright,tunnel}} as fractions of BASE_SPEED */
export function speedsFor(level) {
  for (const band of SPEED_BANDS) if (level <= band.upTo) return band;
  return SPEED_BANDS[SPEED_BANDS.length - 1];
}

/** Dots each ghost must wait for before leaving the house, indexed by GHOST. */
export function houseLimitsFor(level) {
  return bandFor(HOUSE_LIMITS, level);
}

export function releaseTimeoutFor(level) {
  return level >= 5 ? RELEASE_TIMEOUT_MS_L5 : RELEASE_TIMEOUT_MS;
}

/** Alternating scatter/chase durations in seconds. */
export function phasesFor(level) {
  return bandFor(PHASE_TABLE, level);
}
