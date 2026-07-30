/**
 * The brick wall: one flat Uint8Array, allocated once and refilled per level.
 *
 * Each entry is the brick's remaining hit points — 1 for every brick in the
 * classic rules, but stored as a count rather than a boolean so a future tough
 * brick costs a value change and not a data-structure change. Zero is gone.
 *
 * A `remaining` counter rides alongside because "is the screen clear?" is asked
 * every step and scanning 112 entries to answer it would be the only O(n) thing
 * in the step loop.
 */

import {
  BRICK_COLS, BRICK_ROWS, BRICK_COUNT, BRICK_W, BRICK_H, BRICK_TOP,
  brickIndex, ROW_POINTS
} from './constants.js';

export function createBricks() {
  return {
    hp: new Uint8Array(BRICK_COUNT),
    remaining: 0
  };
}

/** Refills every brick in place. Allocates nothing. */
export function resetBricks(bricks) {
  bricks.hp.fill(1);
  bricks.remaining = BRICK_COUNT;
}

export const isAlive = (bricks, index) => bricks.hp[index] > 0;

/**
 * Takes one hit off a brick.
 * @returns {boolean} whether that hit destroyed it
 */
export function damage(bricks, index) {
  if (bricks.hp[index] === 0) return false;
  bricks.hp[index] -= 1;
  if (bricks.hp[index] > 0) return false;
  bricks.remaining -= 1;
  return true;
}

export const rowOf = (index) => Math.floor(index / BRICK_COLS);
export const colOf = (index) => index % BRICK_COLS;

/** Base point value of a brick, before the level multiplier. */
export const pointsOf = (index) => ROW_POINTS[rowOf(index)];

/* --- geometry -------------------------------------------------------------- */

/*
 * Brick bounds in cell space. Kept here rather than in the renderer because the
 * collision solver needs them and core must not import from render/.
 */

export const brickLeft = (index) => colOf(index) * BRICK_W;
export const brickTop = (index) => BRICK_TOP + rowOf(index) * BRICK_H;
export const brickRight = (index) => brickLeft(index) + BRICK_W;
export const brickBottom = (index) => brickTop(index) + BRICK_H;

/** Row of the lowest live brick, or -1 when the screen is clear. */
export function lowestLiveRow(bricks) {
  for (let row = BRICK_ROWS - 1; row >= 0; row--) {
    for (let col = 0; col < BRICK_COLS; col++) {
      if (bricks.hp[brickIndex(row, col)] > 0) return row;
    }
  }
  return -1;
}
