/**
 * Snake's playfield sizing.
 *
 * A thin wrapper so the grid dimensions live in exactly one place. All the
 * actual maths — including the device-pixel snapping that keeps cell edges
 * seam-free at fractional ratios — is shared, in
 * js/shared/render/geometry.js.
 */

import { fitGrid } from '../../../shared/render/geometry.js';
import { COLS, ROWS } from '../core/constants.js';

/** @returns {{cell:number, width:number, height:number}} CSS pixels */
export function fitPlayfield(availableWidth, availableHeight, dpr = 1) {
  return fitGrid(availableWidth, availableHeight, COLS, ROWS, dpr);
}
