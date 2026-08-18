/**
 * Overlap tests. The whole game is axis-aligned boxes, so this is small.
 *
 * There is deliberately no swept collision here, unlike Breakout's solver.
 * Breakout needed one because a fast ball can cross a whole brick between two
 * steps and tunnel through it. Nothing here moves that fast relative to its own
 * size: the quickest object is a bullet at BULLET_SPEED tiles/sec, which at a
 * 60Hz step advances about 0.43 tiles, comfortably less than the ~0.8-tile
 * height of the enemy box it has to hit. Adding a sweep would be machinery
 * guarding against a case the tuning already excludes — but if BULLET_SPEED is
 * ever raised past roughly 48, that stops being true and this comment is the
 * thing that was wrong.
 */

/** Axis-aligned box overlap, both boxes given as centre plus half-extents. */
export function overlaps(ax, ay, ahw, ahh, bx, by, bhw, bhh) {
  return Math.abs(ax - bx) <= ahw + bhw
      && Math.abs(ay - by) <= ahh + bhh;
}

/**
 * Whether a point is inside a boss's tractor beam.
 *
 * The beam is a cone widening from the boss down to the bottom of the screen.
 * Testing against the cone rather than a rectangle matters: a rectangle would
 * catch a ship directly under the boss and a ship far out to the side equally,
 * and the whole tension of the beam is that you can outrun it sideways.
 */
export function insideBeam(bossX, bossY, halfWAtShip, shipX, shipY, fieldBottom) {
  if (shipY < bossY) return false;
  const span = fieldBottom - bossY;
  if (span <= 0) return false;
  const t = Math.min(Math.max((shipY - bossY) / span, 0), 1);
  const halfW = halfWAtShip * t;
  return Math.abs(shipX - bossX) <= halfW;
}
