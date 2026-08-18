/**
 * Hivebreak's playfield sizing.
 *
 * A thin wrapper so the tile dimensions live in one place. All the actual
 * maths — including the device-pixel snapping that keeps sprite edges from
 * shimmering at fractional ratios — is shared, in js/shared/render/geometry.js,
 * which already takes its column and row counts as arguments.
 *
 * This is the fourth game to use fitGrid unchanged, and the second whose
 * objects move continuously rather than on the grid. The grid here is a
 * COORDINATE SYSTEM, not a constraint on movement: a ship at x = 6.9 is
 * perfectly legal, and the only thing the tile count decides is how many
 * device pixels one tile is worth.
 */

import { fitGrid } from '../../../shared/render/geometry.js';
import { COLS, ROWS } from '../core/constants.js';

/** @returns {{cell:number, width:number, height:number}} CSS pixels */
export function fitPlayfield(availableWidth, availableHeight, dpr = 1) {
  return fitGrid(availableWidth, availableHeight, COLS, ROWS, dpr);
}
