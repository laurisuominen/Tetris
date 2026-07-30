/**
 * Swept collision: one primitive, used for walls, bricks and the paddle alike.
 *
 * WHY SWEPT AND NOT A POSITION CHECK
 *
 * A discrete "is the ball overlapping anything?" test run once per step tunnels.
 * At the speeds this game reaches the ball advances most of a brick's height in
 * a single 16.7ms step, so it can be below a brick before the step and above it
 * after, having never occupied it. Testing the ball's PATH instead of its
 * position makes that structurally impossible.
 *
 * THE MINKOWSKI TRICK
 *
 * Rather than write circle-vs-rectangle, every obstacle is expanded by the ball
 * radius on all four sides and the ball is treated as a point. A moving point
 * against a rectangle is the standard ray/AABB slab test — twenty lines, exact,
 * and easy to test. One primitive then serves every obstacle in the game.
 *
 * The approximation, stated rather than hidden: expanding to a square-cornered
 * rectangle instead of a rounded one makes the corners slightly too big. A ball
 * arriving diagonally at a corner registers the hit up to r*(sqrt(2)-1) early —
 * with r = 0.35 cells that is 0.14 of a cell, a couple of pixels at normal
 * sizes. It errs towards DETECTING a collision that a rounded corner would have
 * missed, never towards missing one, so it cannot cause tunnelling. Rounding the
 * corners properly means a ray/capsule test per edge and a ray/circle test per
 * corner, which is eight tests where this is one.
 *
 * Nothing here allocates. `sweep` writes into a caller-owned result object,
 * because it is called ~115 times per step and a fresh object each time is
 * exactly the garbage CLAUDE.md forbids in the loop.
 */

/** Which axis the swept point entered through — this is what flips. */
export const AXIS_X = 1;
export const AXIS_Y = 2;
/** A corner: both slabs entered at the same instant, so both components flip. */
export const AXIS_BOTH = AXIS_X | AXIS_Y;

/**
 * Entry times closer than this count as simultaneous, i.e. a corner hit.
 *
 * Without it, a ball arriving at an exact 45 degrees on an exact corner picks
 * whichever axis wins by one float ULP and reflects along a single component,
 * which looks like the ball passing through the corner of a brick.
 */
const CORNER_EPSILON = 1e-9;

/**
 * A reusable result record. Create one per caller, not one per call.
 * @returns {{hit:boolean, t:number, axis:number}}
 */
export function createHit() {
  return { hit: false, t: 0, axis: 0 };
}

/**
 * Sweeps a point from (px,py) along (dx,dy) against an axis-aligned box that
 * has ALREADY been expanded by the ball radius.
 *
 * `t` is the fraction of (dx,dy) travelled before contact, in [0,1].
 *
 * @param {{hit:boolean,t:number,axis:number}} out  written in place
 * @returns {boolean} whether a hit was recorded
 */
export function sweep(out, px, py, dx, dy, minX, minY, maxX, maxY) {
  out.hit = false;

  // Per-axis entry and exit times. A zero component means the ray is parallel
  // to that pair of slabs: it can never enter through them, so it is only a hit
  // if the point already lies between them. Dividing by zero would give
  // +/-Infinity and, when the point is outside, NaN via Infinity - Infinity.
  let entryX;
  let exitX;
  if (dx === 0) {
    if (px < minX || px > maxX) return false;
    entryX = -Infinity;
    exitX = Infinity;
  } else {
    const inv = 1 / dx;
    let a = (minX - px) * inv;
    let b = (maxX - px) * inv;
    if (a > b) { const swap = a; a = b; b = swap; }
    entryX = a;
    exitX = b;
  }

  let entryY;
  let exitY;
  if (dy === 0) {
    if (py < minY || py > maxY) return false;
    entryY = -Infinity;
    exitY = Infinity;
  } else {
    const inv = 1 / dy;
    let a = (minY - py) * inv;
    let b = (maxY - py) * inv;
    if (a > b) { const swap = a; a = b; b = swap; }
    entryY = a;
    exitY = b;
  }

  const entry = Math.max(entryX, entryY);
  const exit = Math.min(exitX, exitY);

  // Passes beside the box, or the box is entirely behind the ray.
  if (entry > exit || exit < 0) return false;
  // Contact is further away than this step travels.
  if (entry > 1) return false;

  // entry < 0 means the point STARTED inside the expanded box. That is a
  // degenerate case the caller has to handle differently — reflecting off a
  // surface you are already inside pushes you further in. Report it as a
  // non-hit and let the caller's overlap-ejection path deal with it; see
  // ejectFromBox below.
  if (entry < 0) return false;

  out.hit = true;
  out.t = entry;

  if (Math.abs(entryX - entryY) <= CORNER_EPSILON) out.axis = AXIS_BOTH;
  else out.axis = entryX > entryY ? AXIS_X : AXIS_Y;

  return true;
}

/**
 * Pushes a point that is already inside an expanded box out through its nearest
 * face, and says which axis that was.
 *
 * This is not a fallback for a failed sweep — it is the correct answer for the
 * one case a sweep cannot express. The paddle is teleported by the pointer
 * rather than swept, so it can appear on top of the ball with no path to
 * intersect. Without this the ball is swallowed: it sits inside the paddle,
 * every sweep starts inside, and nothing ever reflects it.
 *
 * @returns {number} AXIS_X or AXIS_Y, or 0 if the point was not inside
 */
export function ejectFromBox(out, px, py, minX, minY, maxX, maxY) {
  if (px <= minX || px >= maxX || py <= minY || py >= maxY) return 0;

  const left = px - minX;
  const right = maxX - px;
  const up = py - minY;
  const down = maxY - py;

  const nearestX = Math.min(left, right);
  const nearestY = Math.min(up, down);

  if (nearestX < nearestY) {
    out.x = left < right ? minX : maxX;
    out.y = py;
    return AXIS_X;
  }
  out.x = px;
  out.y = up < down ? minY : maxY;
  return AXIS_Y;
}
