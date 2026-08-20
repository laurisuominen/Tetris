/**
 * Board queries, and the mutable pellet layer.
 *
 * The wall layout never changes, so it is read straight from mazeData. Pellets
 * DO change, so they live in a Uint8Array allocated once per game and cleared
 * between levels — never reallocated, per CLAUDE.md's rule about the loop.
 *
 * Everything here takes SIMULATION coordinates (28 x 36). Converting to a row of
 * mazeData means subtracting MAZE_TOP, and that subtraction happens in exactly
 * one place — tileAt — so the rest of the game never thinks about it.
 */

import {
  COLS, ROWS, MAZE_TOP, MAZE_BOTTOM, TUNNEL_ROW, TUNNEL_LEFT_MAX, TUNNEL_RIGHT_MIN,
  RED_ZONE_X_MIN, RED_ZONE_X_MAX, RED_ZONE_ROWS
} from './constants.js';
import { MAZE_ROWS_TEXT, WALL, DOT, ENERGIZER, DOOR, OPEN } from './mazeData.js';

export const PELLET = Object.freeze({ NONE: 0, DOT: 1, ENERGIZER: 2 });

/** Raw board character at a simulation tile, or WALL outside the maze rows. */
export function tileAt(x, y) {
  if (y < MAZE_TOP || y > MAZE_BOTTOM) return OPEN;   // dead space, see below
  if (x < 0 || x >= COLS) return OPEN;
  return MAZE_ROWS_TEXT[y - MAZE_TOP][x];
}

/**
 * Rows outside the maze read as OPEN rather than WALL, and that is deliberate.
 * Scatter targets live out there — Blinky aims at (25, 0). Ghosts never actually
 * go there because no walkable tile connects to it, but a DISTANCE to it has to
 * be computable, and treating the dead space as wall would not change that
 * either way. OPEN is simply the honest answer: it is not a wall, it is nothing.
 */

/** Can a normal actor stand here? Doors are passable only by ghosts — see below. */
export function isWalkable(x, y) {
  const t = tileAt(x, y);
  return t !== WALL;
}

/** The player may never pass the ghost-house door. */
export function isWalkableByPlayer(x, y) {
  const t = tileAt(x, y);
  return t !== WALL && t !== DOOR;
}

export function isDoor(x, y) {
  return tileAt(x, y) === DOOR;
}

/** The wrap-around row. Speeds are reduced here for ghosts. */
export function isTunnel(x, y) {
  return y === TUNNEL_ROW && (x <= TUNNEL_LEFT_MAX || x >= TUNNEL_RIGHT_MIN);
}

/**
 * The two zones where a ghost may not TURN upward.
 *
 * It may keep travelling up if it is already doing so — the restriction is on
 * choosing up at a junction, not on the direction itself. Frightened ghosts
 * ignore it entirely.
 */
export function isRedZone(x, y) {
  return x >= RED_ZONE_X_MIN && x <= RED_ZONE_X_MAX && RED_ZONE_ROWS.includes(y);
}

/** Wraps x through the tunnel. Y never wraps. */
export function wrapX(x) {
  if (x < -1) return COLS + 1;
  if (x > COLS + 1) return -1;
  return x;
}

/* --- the pellet layer -------------------------------------------------------- */

/** One byte per tile of the MAZE (not the full screen). Allocated once. */
export function createPellets() {
  return new Uint8Array(COLS * (MAZE_BOTTOM - MAZE_TOP + 1));
}

const pelletIndex = (x, y) => (y - MAZE_TOP) * COLS + x;

/** Refills the board for a new level. Returns how many pellets were laid. */
export function resetPellets(pellets) {
  let count = 0;
  for (let y = MAZE_TOP; y <= MAZE_BOTTOM; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const t = tileAt(x, y);
      let v = PELLET.NONE;
      if (t === DOT) v = PELLET.DOT;
      else if (t === ENERGIZER) v = PELLET.ENERGIZER;
      pellets[pelletIndex(x, y)] = v;
      if (v !== PELLET.NONE) count += 1;
    }
  }
  return count;
}

export function pelletAt(pellets, x, y) {
  if (y < MAZE_TOP || y > MAZE_BOTTOM || x < 0 || x >= COLS) return PELLET.NONE;
  return pellets[pelletIndex(x, y)];
}

export function eatPellet(pellets, x, y) {
  if (y < MAZE_TOP || y > MAZE_BOTTOM || x < 0 || x >= COLS) return PELLET.NONE;
  const i = pelletIndex(x, y);
  const v = pellets[i];
  pellets[i] = PELLET.NONE;
  return v;
}
