/**
 * Ghost state and pathing.
 *
 * All four run this identical code. The only thing that distinguishes them is
 * the target tile core/targeting.js hands back — see the note there.
 *
 * HOW A GHOST STEERS. It does not path-find. At every tile it looks at the up to
 * four neighbouring tiles, discards the one behind it, and takes whichever of the
 * rest is closest to its target as the crow flies. That is all. The famous
 * behaviours are emergent, and the two rules that shape them are:
 *
 *  - NO REVERSING. A ghost may not turn back on itself except when the system
 *    forces it on a mode change. This is why a ghost commits to a wrong turn and
 *    why the player can exploit it.
 *  - NO TURNING UP IN THE RED ZONES. Four specific stretches of corridor where an
 *    upward turn is refused. Frightened ghosts ignore this.
 *
 * Distances are compared SQUARED. Nothing takes a square root, and the tie-break
 * falls out of iterating DIRS in order: up, left, down, right.
 */

import {
  DIRS, OPPOSITE, UP, GHOST, HOUSE_SLOTS, HOUSE_DOOR, HOUSE_CENTRE
} from './constants.js';
import { createActor, tileOf, centreOf, advance, wrapThroughTunnel } from './actor.js';
import { isRedZone } from './maze.js';

export const GHOST_STATE = Object.freeze({
  HOUSE: 'HOUSE',           // bobbing inside, waiting for its dot count
  LEAVING: 'LEAVING',       // scripted path out through the door
  OUT: 'OUT',               // normal scatter/chase pathing
  FRIGHTENED: 'FRIGHTENED', // blue, wandering
  EYES: 'EYES',             // eaten, heading back to the house
  ENTERING: 'ENTERING'      // scripted path back in
});

/**
 * The best direction from a tile toward a target.
 *
 * PURE, and the second-most-testable function in the game after targeting.
 *
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} dir current direction; reversing is not considered
 * @param {{x,y}} target may be outside the maze — that is normal for scatter
 * @param {(x,y)=>boolean} canWalk
 * @param {boolean} allowUp false inside a red zone
 * @returns {number} a direction index; falls back to reversing when boxed in
 */
export function bestDirection(tileX, tileY, dir, target, canWalk, allowUp = true) {
  const back = OPPOSITE[dir];
  let best = -1;
  let bestDist = Infinity;

  // DIRS is ordered up, left, down, right — so a strict < keeps the first of
  // any tie, which IS the arcade's preference order.
  for (let d = 0; d < DIRS.length; d += 1) {
    if (d === back) continue;
    if (d === UP && !allowUp) continue;

    const nx = tileX + DIRS[d].dx;
    const ny = tileY + DIRS[d].dy;
    if (!canWalk(nx, ny)) continue;

    const dx = nx - target.x;
    const dy = ny - target.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }

  // Boxed in — a dead end. Reversing is the only legal move and the arcade does
  // the same. This happens nowhere on the real board but a maze edit could
  // create it, and returning -1 here would be a silent freeze.
  return best === -1 ? back : best;
}

/** A random legal direction, for frightened wandering. */
export function randomDirection(tileX, tileY, dir, canWalk, rand) {
  const back = OPPOSITE[dir];
  const options = [];
  for (let d = 0; d < DIRS.length; d += 1) {
    if (d === back) continue;
    if (canWalk(tileX + DIRS[d].dx, tileY + DIRS[d].dy)) options.push(d);
  }
  if (options.length === 0) return back;
  return options[Math.floor(rand() * options.length) % options.length];
}

export function createGhosts() {
  return [GHOST.BLINKY, GHOST.PINKY, GHOST.INKY, GHOST.CLYDE].map((id) => ({
    id,
    ...createActor(HOUSE_SLOTS[id].x, HOUSE_SLOTS[id].y, id === GHOST.BLINKY ? 1 : 0),
    state: GHOST_STATE.HOUSE,
    /** Which tile the ghost last made a decision in; stops re-deciding mid-tile. */
    decidedTile: -1,
    /** Bob direction while waiting in the house. */
    bob: 1,
    /** Cruise Elroy stage, Blinky only. */
    elroy: 0,
    /** Index into the 200/400/800/1600 chain when eaten. */
    chainIndex: 0
  }));
}

/** Puts every ghost back at its start for a new level or after a death. */
export function resetGhosts(ghosts) {
  for (const g of ghosts) {
    g.x = HOUSE_SLOTS[g.id].x;
    g.y = HOUSE_SLOTS[g.id].y;
    g.dir = g.id === GHOST.BLINKY ? 1 : 0;
    g.nextDir = g.dir;
    g.state = g.id === GHOST.BLINKY ? GHOST_STATE.OUT : GHOST_STATE.HOUSE;
    g.decidedTile = -1;
    g.bob = 1;
    g.elroy = 0;
    g.chainIndex = 0;
  }
}

export const isInHouse = (ghost) =>
  ghost.state === GHOST_STATE.HOUSE || ghost.state === GHOST_STATE.ENTERING;

export const isEdible = (ghost) => ghost.state === GHOST_STATE.FRIGHTENED;

export const isThreat = (ghost) =>
  ghost.state === GHOST_STATE.OUT || ghost.state === GHOST_STATE.LEAVING;

/**
 * Scripted movement inside the house — bobbing, leaving, and returning.
 *
 * Deliberately NOT general pathing. The house is three tiles of open floor
 * behind a one-way door; running the normal steering there produces ghosts that
 * jitter against the walls. The arcade scripts it too.
 *
 * @returns {boolean} true when the scripted phase has finished
 */
export function stepHouse(ghost, distance) {
  switch (ghost.state) {
    case GHOST_STATE.HOUSE: {
      // Bob up and down about the slot's resting height.
      const home = HOUSE_SLOTS[ghost.id].y;
      ghost.y += ghost.bob * distance;
      if (ghost.y > home + 0.35) { ghost.y = home + 0.35; ghost.bob = -1; }
      if (ghost.y < home - 0.35) { ghost.y = home - 0.35; ghost.bob = 1; }
      return false;
    }

    case GHOST_STATE.LEAVING: {
      // Slide to the door column, then rise through it.
      if (Math.abs(ghost.x - HOUSE_DOOR.x) > 0.02) {
        const step = Math.sign(HOUSE_DOOR.x - ghost.x) * distance;
        ghost.x = Math.abs(step) >= Math.abs(HOUSE_DOOR.x - ghost.x)
          ? HOUSE_DOOR.x : ghost.x + step;
        return false;
      }
      ghost.y -= distance;
      if (ghost.y <= HOUSE_DOOR.y) {
        ghost.y = HOUSE_DOOR.y;
        return true;
      }
      return false;
    }

    case GHOST_STATE.ENTERING: {
      // Drop through the door, then slide to the slot.
      if (ghost.y < HOUSE_CENTRE.y - 0.02) {
        ghost.x = HOUSE_DOOR.x;
        ghost.y = Math.min(ghost.y + distance, HOUSE_CENTRE.y);
        return false;
      }
      const home = HOUSE_SLOTS[ghost.id].x;
      if (Math.abs(ghost.x - home) > 0.02) {
        const step = Math.sign(home - ghost.x) * distance;
        ghost.x = Math.abs(step) >= Math.abs(home - ghost.x) ? home : ghost.x + step;
        return false;
      }
      return true;
    }

    default:
      return true;
  }
}

/**
 * One step of normal pathing.
 *
 * The decision is taken ONCE per tile, on entry. Re-deciding every frame would
 * let a ghost oscillate on a tile boundary when two directions are equidistant.
 */
export function stepPathing(ghost, distance, target, canWalk, frightened, rand) {
  const tx = tileOf(ghost.x);
  const ty = tileOf(ghost.y);
  const key = ty * 64 + tx;

  if (ghost.decidedTile !== key) {
    ghost.decidedTile = key;
    const allowUp = frightened || !isRedZone(tx, ty);
    ghost.dir = frightened
      ? randomDirection(tx, ty, ghost.dir, canWalk, rand)
      : bestDirection(tx, ty, ghost.dir, target, canWalk, allowUp);
    // Re-centre on the new lane so the turn is clean.
    if (DIRS[ghost.dir].dx !== 0) ghost.y = centreOf(ty);
    else ghost.x = centreOf(tx);
  }

  advance(ghost, distance, canWalk);
  wrapThroughTunnel(ghost);
}

/**
 * The forced reversal on every scatter/chase change.
 *
 * Applied to ghosts that are OUT or FRIGHTENED only — one in the house or
 * travelling as eyes is unaffected. Clearing decidedTile is what makes the
 * reversal take effect immediately rather than at the next tile.
 */
export function forceReverse(ghosts) {
  for (const g of ghosts) {
    if (g.state !== GHOST_STATE.OUT && g.state !== GHOST_STATE.FRIGHTENED) continue;
    g.dir = OPPOSITE[g.dir];
    g.decidedTile = -1;
  }
}
