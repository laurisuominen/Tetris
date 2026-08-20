/**
 * The wall layer, drawn once.
 *
 * The maze never changes shape, so this is painted into its own canvas at boot
 * and on resize, then blitted. Same reasoning as Breakout's brick layer — and
 * the opposite of Hivebreak, where nothing is static and a second layer would be
 * a cache that always misses.
 *
 * HOW THE WALLS ARE DRAWN. Not as filled blocks: the arcade maze is an OUTLINE,
 * and filling the tiles gives a chunky silhouette that reads as a different
 * game. Instead every edge between a wall tile and a non-wall tile is stroked.
 * That is a purely local rule over the tile map — no corner cases, no authored
 * geometry — and it produces the classic hollow-corridor look for free.
 */

import { COLS, MAZE_TOP, MAZE_BOTTOM } from '../core/constants.js';
import { tileAt } from '../core/maze.js';
import { toScreenY } from './geometry.js';
import { WALL, DOOR } from '../core/mazeData.js';

const isWallTile = (x, y) => tileAt(x, y) === WALL;

export function drawMaze(ctx, cell, palette) {
  ctx.clearRect(0, 0, COLS * cell, (MAZE_BOTTOM - MAZE_TOP + 1) * cell);

  ctx.strokeStyle = palette.wall;
  ctx.lineWidth = Math.max(cell * 0.14, 1);
  ctx.lineCap = 'round';
  ctx.beginPath();

  for (let y = MAZE_TOP; y <= MAZE_BOTTOM; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!isWallTile(x, y)) continue;

      const sx = x * cell;
      const sy = toScreenY(y) * cell;

      // Stroke only the sides that face open space. Interior edges between two
      // wall tiles are left alone, which is what hollows the blocks out.
      if (!isWallTile(x, y - 1)) { ctx.moveTo(sx, sy); ctx.lineTo(sx + cell, sy); }
      if (!isWallTile(x, y + 1)) { ctx.moveTo(sx, sy + cell); ctx.lineTo(sx + cell, sy + cell); }
      if (!isWallTile(x - 1, y)) { ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + cell); }
      if (!isWallTile(x + 1, y)) { ctx.moveTo(sx + cell, sy); ctx.lineTo(sx + cell, sy + cell); }
    }
  }
  ctx.stroke();

  // The ghost-house door: a bar rather than a wall, so it reads as passable.
  ctx.strokeStyle = palette.door;
  ctx.lineWidth = Math.max(cell * 0.16, 1);
  ctx.beginPath();
  for (let y = MAZE_TOP; y <= MAZE_BOTTOM; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (tileAt(x, y) !== DOOR) continue;
      const sx = x * cell;
      const sy = toScreenY(y) * cell + cell / 2;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + cell, sy);
    }
  }
  ctx.stroke();
}
