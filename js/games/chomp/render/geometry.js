/**
 * Chomp's playfield sizing.
 *
 * A thin wrapper so the tile dimensions live in one place. The actual maths —
 * including the device-pixel snapping that keeps wall lines from shimmering at
 * fractional ratios — is shared, in js/shared/render/geometry.js, which already
 * takes its column and row counts as arguments. Fifth game, still unchanged.
 *
 * THE CROP. Core simulates 28 x 36 tiles because every documented constant is in
 * that system — scatter targets sit outside the maze at y=0 and y=34. Only rows
 * MAZE_TOP..MAZE_BOTTOM are worth drawing, so the canvas is sized for 31 rows
 * and a simulation y is shifted by MAZE_TOP on the way to the screen.
 *
 * This one offset is the entire price of keeping the arcade's coordinates.
 */

import { fitGrid } from '../../../shared/render/geometry.js';
import { COLS, MAZE_ROWS, MAZE_TOP } from '../core/constants.js';

/** @returns {{cell:number, width:number, height:number}} CSS pixels */
export function fitPlayfield(availableWidth, availableHeight, dpr = 1) {
  return fitGrid(availableWidth, availableHeight, COLS, MAZE_ROWS, dpr);
}

/** Simulation y -> drawing y, both in tiles. */
export const toScreenY = (simY) => simY - MAZE_TOP;
