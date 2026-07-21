/**
 * Layout maths for the canvas. Pure — no DOM — so the snapping rule is testable.
 *
 * "Pixel-crisp" comes from here, not from image-rendering: pixelated (which v1
 * used and which does nothing for vector drawing while harming rounded
 * corners). The trick is choosing a cell size whose product with the device
 * pixel ratio is a whole number, so no block edge ever lands mid-pixel.
 *
 * This matters most at fractional ratios — Windows display scaling at 125% and
 * 150% gives dpr 1.25 and 1.5, where an unsnapped cell size produces visible
 * seams between blocks.
 */

import { COLS, VISIBLE_ROWS } from '../core/constants.js';

/**
 * Largest cell size that fits the available box and lands on whole device
 * pixels.
 *
 * @returns {{cell:number, width:number, height:number}} all in CSS pixels
 */
export function fitPlayfield(availableWidth, availableHeight, dpr = 1) {
  const byWidth = availableWidth / COLS;
  const byHeight = availableHeight / VISIBLE_ROWS;
  const raw = Math.min(byWidth, byHeight);

  // Snap down so cell * dpr is an integer number of device pixels.
  const cell = Math.max(Math.floor(raw * dpr) / dpr, 1 / dpr);

  return {
    cell,
    width: cell * COLS,
    height: cell * VISIBLE_ROWS
  };
}

/** Backing-store size for a canvas at the given CSS size and ratio. */
export function backingSize(cssWidth, cssHeight, dpr = 1) {
  return {
    width: Math.round(cssWidth * dpr),
    height: Math.round(cssHeight * dpr)
  };
}

/**
 * Offset that puts a 1px stroke on a single device pixel instead of straddling
 * two. Canvas strokes are centred on the path, so a line at an integer
 * coordinate spreads half a pixel either side and renders blurry.
 */
export const crispOffset = (dpr = 1) => 0.5 / dpr;

/** Cell size for a preview box holding `columns` x `rows` cells. */
export function fitPreview(availableWidth, availableHeight, columns, rows, dpr = 1) {
  const raw = Math.min(availableWidth / columns, availableHeight / rows);
  return Math.max(Math.floor(raw * dpr) / dpr, 1 / dpr);
}
