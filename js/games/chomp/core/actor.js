/**
 * Movement shared by the player and the ghosts.
 *
 * COORDINATES. Position is in continuous tile units; the tile an actor occupies
 * is floor(x), floor(y), and the centre of tile T is T + 0.5. An actor travelling
 * horizontally has its y pinned to the lane centre and vice versa, so it can only
 * ever be off-centre along its direction of travel.
 *
 * Nothing here knows about pellets, ghosts or scoring — it moves a point around a
 * grid and reports where it is.
 */

import { DIRS, OPPOSITE, COLS } from './constants.js';

export const isHorizontal = (dir) => DIRS[dir].dx !== 0;

export const tileOf = (v) => Math.floor(v);
export const centreOf = (tile) => tile + 0.5;

export function createActor(x, y, dir) {
  return {
    x,
    y,
    dir,
    /** Buffered input: applied at the first tile where it becomes legal. */
    nextDir: dir
  };
}

/** How far the actor is from its current tile's centre, along its travel axis. */
export function offsetFromCentre(actor) {
  const along = isHorizontal(actor.dir) ? actor.x : actor.y;
  return along - centreOf(tileOf(along));
}

/**
 * Attempts to apply the buffered direction.
 *
 * A reversal is always legal and instant — that is true in the arcade for both
 * the player and for the forced reversals on a mode change. A perpendicular turn
 * needs an open tile and proximity to the lane centre.
 *
 * @param {(x:number,y:number)=>boolean} canWalk
 * @param {number} tolerance how early the turn may be taken, in tiles
 */
export function tryTurn(actor, canWalk, tolerance) {
  const next = actor.nextDir;
  if (next === null || next === undefined || next === actor.dir) return false;

  if (next === OPPOSITE[actor.dir]) {
    actor.dir = next;
    return true;
  }

  const tx = tileOf(actor.x);
  const ty = tileOf(actor.y);
  const d = DIRS[next];
  if (!canWalk(tx + d.dx, ty + d.dy)) return false;

  if (Math.abs(offsetFromCentre(actor)) > tolerance) return false;

  // Snap onto the new lane. This is the corner-cut: the actor does not travel to
  // the centre first, it leaves from wherever it is.
  if (isHorizontal(actor.dir)) actor.x = centreOf(tx);
  else actor.y = centreOf(ty);

  actor.dir = next;
  return true;
}

/**
 * Advances by `distance` tiles, stopping dead at a wall.
 *
 * Stopping AT the wall rather than short of it matters: an actor parked flush
 * against a wall is at the tile centre, which is exactly where a turn becomes
 * legal. Stopping short would leave the player unable to turn while held against
 * a wall — the single most common feel bug in a maze game.
 *
 * @returns {boolean} whether it actually moved
 */
export function advance(actor, distance, canWalk) {
  if (distance <= 0) return false;

  const d = DIRS[actor.dir];
  const tx = tileOf(actor.x);
  const ty = tileOf(actor.y);
  const blocked = !canWalk(tx + d.dx, ty + d.dy);

  if (blocked) {
    // The furthest legal point is the centre of the tile we are in.
    const along = d.dx !== 0 ? actor.x : actor.y;
    const limit = centreOf(d.dx !== 0 ? tx : ty);
    const moving = d.dx > 0 || d.dy > 0;
    const wouldPass = moving ? along + distance > limit : along - distance < limit;
    if (wouldPass) {
      if (d.dx !== 0) actor.x = limit;
      else actor.y = limit;
      return false;
    }
  }

  actor.x += d.dx * distance;
  actor.y += d.dy * distance;

  // Keep the perpendicular axis exactly on the lane, so float drift cannot
  // accumulate an actor off its corridor over thousands of steps.
  if (d.dx !== 0) actor.y = centreOf(tileOf(actor.y));
  else actor.x = centreOf(tileOf(actor.x));

  return true;
}

/** The side tunnel. Only x wraps, and only well outside the board. */
export function wrapThroughTunnel(actor) {
  if (actor.x < -0.5) actor.x = COLS + 0.5;
  else if (actor.x > COLS + 0.5) actor.x = -0.5;
}
