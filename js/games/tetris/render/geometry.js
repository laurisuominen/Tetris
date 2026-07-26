/**
 * Tetris-specific canvas layout.
 *
 * The device-pixel snapping rule itself is shared (see
 * js/shared/render/geometry.js); this only binds it to the playfield's fixed
 * 10 x 20 visible grid.
 */

import { fitGrid } from '../../../shared/render/geometry.js';
import { COLS, VISIBLE_ROWS } from '../core/constants.js';

/**
 * Largest playfield that fits the available box and lands on whole device
 * pixels.
 *
 * @returns {{cell:number, width:number, height:number}} all in CSS pixels
 */
export function fitPlayfield(availableWidth, availableHeight, dpr = 1) {
  return fitGrid(availableWidth, availableHeight, COLS, VISIBLE_ROWS, dpr);
}
