/**
 * Ghost target selection. The most important file in this game.
 *
 * Every ghost runs the SAME movement code; the only thing that separates
 * Blinky's relentless pursuit from Clyde's dithering is which tile this function
 * returns. That is the whole design of the original, and keeping it as one pure
 * function of integers is what makes it testable to the letter.
 *
 * Pure: no state, no DOM, no randomness, no floats in the result. Same inputs,
 * same tile, always.
 *
 * THE UP-BUG
 * ----------
 * Pinky and Inky both look a fixed number of tiles AHEAD of the player. In the
 * arcade, "ahead" while facing up is also four (or two) tiles to the LEFT — an
 * overflow in the original's offset table. It is a bug, and it is load-bearing:
 * the classic ambush patterns and several well-known safe spots exist because of
 * it. So it is reproduced by default, and `modern` turns it off.
 *
 * `modern` changes THESE TWO OFFSETS AND NOTHING ELSE. It is not a difficulty
 * setting and it does not touch Blinky or Clyde.
 */

import {
  GHOST, DIRS, UP, SCATTER_TARGETS, CLYDE_SHY_DISTANCE
} from './constants.js';

export const MODE = Object.freeze({
  SCATTER: 'SCATTER',
  CHASE: 'CHASE',
  FRIGHTENED: 'FRIGHTENED'
});

/**
 * The tile `n` ahead of the player, reproducing the arcade's overflow.
 *
 * @param {boolean} modern true = the corrected offset, no leftward drift
 */
export function aheadOf(tileX, tileY, dir, n, modern = false) {
  const d = DIRS[dir];
  let x = tileX + d.dx * n;
  let y = tileY + d.dy * n;
  // The bug: facing up also shifts left by the same amount.
  if (dir === UP && !modern) x -= n;
  return { x, y };
}

/** Blinky: straight at the player. No cleverness at all, and none needed. */
function blinkyTarget(pac) {
  return { x: pac.tileX, y: pac.tileY };
}

/** Pinky: four ahead, to cut the player off rather than follow. */
function pinkyTarget(pac, modern) {
  return aheadOf(pac.tileX, pac.tileY, pac.dir, 4, modern);
}

/**
 * Inky: the strangest of the four, and the only one that reads another ghost.
 *
 * Take the tile two ahead of the player, draw a vector from BLINKY to it, then
 * double that vector. The result is that Inky is docile while Blinky is far away
 * and vicious when Blinky is closing — the two of them pincer without any code
 * that says so.
 */
function inkyTarget(pac, blinkyTile, modern) {
  const pivot = aheadOf(pac.tileX, pac.tileY, pac.dir, 2, modern);
  return {
    x: pivot.x + (pivot.x - blinkyTile.tileX),
    y: pivot.y + (pivot.y - blinkyTile.tileY)
  };
}

/**
 * Clyde: chases like Blinky until he gets within eight tiles, then bolts for his
 * own corner — which sends him back toward the player again once he is far
 * enough away. The loop that produces looks like cowardice and is the reason he
 * is the least dangerous ghost.
 *
 * Distance is compared squared, so nothing takes a square root.
 */
function clydeTarget(pac, self) {
  const dx = pac.tileX - self.tileX;
  const dy = pac.tileY - self.tileY;
  const far = dx * dx + dy * dy >= CLYDE_SHY_DISTANCE * CLYDE_SHY_DISTANCE;
  return far ? { x: pac.tileX, y: pac.tileY } : SCATTER_TARGETS[GHOST.CLYDE];
}

/**
 * The target tile for one ghost right now.
 *
 * @param {number} ghost      GHOST.BLINKY | PINKY | INKY | CLYDE
 * @param {string} mode       MODE.SCATTER | CHASE  (frightened never calls this)
 * @param {{tileX,tileY,dir}} pac
 * @param {{tileX,tileY}} self
 * @param {{tileX,tileY}} blinky  Inky reads this; ignored by the others
 * @param {boolean} modern    corrected offsets — see the up-bug note above
 * @returns {{x:number,y:number}} a tile, which may be outside the maze
 */
export function targetTile(ghost, mode, pac, self, blinky, modern = false) {
  if (mode === MODE.SCATTER) return SCATTER_TARGETS[ghost];

  switch (ghost) {
    case GHOST.BLINKY: return blinkyTarget(pac);
    case GHOST.PINKY:  return pinkyTarget(pac, modern);
    case GHOST.INKY:   return inkyTarget(pac, blinky, modern);
    case GHOST.CLYDE:  return clydeTarget(pac, self);
    default:           return blinkyTarget(pac);
  }
}

/**
 * Cruise Elroy: Blinky abandons scatter and keeps chasing once the board thins
 * out. Applied by the caller, because it is a MODE override rather than a
 * different target — Blinky in Elroy simply never scatters.
 */
export function elroyIgnoresScatter(ghost, elroyStage) {
  return ghost === GHOST.BLINKY && elroyStage > 0;
}
