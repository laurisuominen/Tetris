/**
 * Flight paths — the curves enemies fly along, and the only genuinely new
 * simulation idea in this game.
 *
 * WHY BAKED LOOKUP TABLES
 * -----------------------
 * A Catmull-Rom spline is cheap to evaluate but not cheap ENOUGH: there can be
 * forty enemies on a path at once, every frame, and evaluating the polynomial
 * per enemy per frame does real work for a curve that never changes. So each
 * path is sampled once at module load into a pair of Float32Arrays and never
 * touched again. Following a path is then two array reads and a lerp.
 *
 * This is also what satisfies CLAUDE.md's "do not allocate inside the loop":
 * the tables are built at boot, `samplePath` writes into a caller-owned record,
 * and a step produces no garbage at all.
 *
 * WHY ARC LENGTH, NOT THE SPLINE PARAMETER
 * ----------------------------------------
 * Advancing `t` uniformly along a Catmull-Rom spline does NOT move at uniform
 * speed — the point crawls through tight curves and races down straights. That
 * reads as enemies stalling at exactly the moment they are hardest to hit. So
 * each table also stores cumulative arc length, and enemies advance by DISTANCE
 * in tiles per second. `samplePath` binary-searches the cumulative array.
 *
 * COORDINATES
 * -----------
 * Entry paths are ABSOLUTE tile positions: they start off-screen and end near
 * the formation. Dive paths are RELATIVE offsets from wherever the enemy left
 * its slot, so one definition serves every slot. `flip` mirrors x about the
 * path's own origin, which is what lets one curve serve both sides.
 */

import { COLS, ROWS } from './constants.js';

/** Samples per path. Dense enough that the lerp between them is invisible. */
const SAMPLES = 192;

/* --- spline maths ----------------------------------------------------------- */

/**
 * Catmull-Rom through p1 and p2, with p0 and p3 as the surrounding tangent
 * controls. The standard uniform form; endpoints are handled by duplicating
 * the first and last control point in `bake` below.
 */
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * Sample a control polygon into arrays of positions plus cumulative length.
 *
 * @param {Array<[number, number]>} points control points, at least two
 * @returns {{xs: Float32Array, ys: Float32Array, cum: Float32Array, length: number}}
 */
export function bake(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('bake requires at least two control points');
  }

  const xs = new Float32Array(SAMPLES);
  const ys = new Float32Array(SAMPLES);
  const cum = new Float32Array(SAMPLES);

  const n = points.length;
  const segments = n - 1;

  for (let i = 0; i < SAMPLES; i += 1) {
    // u spans the whole polygon; seg picks which pair we are between.
    const u = (i / (SAMPLES - 1)) * segments;
    let seg = Math.floor(u);
    if (seg >= segments) seg = segments - 1;
    const t = u - seg;

    // Duplicate the ends rather than wrapping: these are open curves.
    const p0 = points[Math.max(seg - 1, 0)];
    const p1 = points[seg];
    const p2 = points[Math.min(seg + 1, n - 1)];
    const p3 = points[Math.min(seg + 2, n - 1)];

    xs[i] = catmullRom(p0[0], p1[0], p2[0], p3[0], t);
    ys[i] = catmullRom(p0[1], p1[1], p2[1], p3[1], t);

    if (i === 0) {
      cum[i] = 0;
    } else {
      const dx = xs[i] - xs[i - 1];
      const dy = ys[i] - ys[i - 1];
      cum[i] = cum[i - 1] + Math.hypot(dx, dy);
    }
  }

  return { xs, ys, cum, length: cum[SAMPLES - 1] };
}

/**
 * Position at `distance` tiles along a baked path.
 *
 * Writes into `out` and returns it — no allocation. Past the end it clamps to
 * the final sample, so a caller that overshoots gets the endpoint rather than
 * NaN; callers detect completion by comparing distance to `path.length`.
 */
export function samplePath(path, distance, out) {
  const { xs, ys, cum, length } = path;

  if (!(distance > 0)) {          // also catches NaN
    out.x = xs[0];
    out.y = ys[0];
    return out;
  }
  if (distance >= length) {
    out.x = xs[SAMPLES - 1];
    out.y = ys[SAMPLES - 1];
    return out;
  }

  // Binary search for the last sample at or before `distance`.
  let lo = 0;
  let hi = SAMPLES - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= distance) lo = mid;
    else hi = mid;
  }

  const span = cum[hi] - cum[lo];
  const t = span > 0 ? (distance - cum[lo]) / span : 0;
  out.x = xs[lo] + (xs[hi] - xs[lo]) * t;
  out.y = ys[lo] + (ys[hi] - ys[lo]) * t;
  return out;
}

/**
 * Facing angle at `distance`, in radians, with 0 pointing DOWN the screen.
 *
 * Taken from a finite difference on the baked table rather than from the
 * derivative of the spline: the table is what the enemy actually follows, so
 * differencing it cannot disagree with the position the player sees.
 */
export function headingAt(path, distance, scratchA, scratchB) {
  const step = 0.12;
  samplePath(path, Math.max(distance - step, 0), scratchA);
  samplePath(path, Math.min(distance + step, path.length), scratchB);
  const dx = scratchB.x - scratchA.x;
  const dy = scratchB.y - scratchA.y;
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2(dx, dy);
}

/* --- the paths themselves --------------------------------------------------- */

const MID = COLS / 2;

/**
 * ENTRY paths. Absolute tile space, starting off-screen.
 *
 * Each ends at a rally point near the top-centre; the enemy then peels off to
 * its own formation slot (see enemies.js SEEKING). Ending them all in roughly
 * the same place is what makes a wave read as one stream rather than as forty
 * independent objects.
 */
export const ENTRY_PATHS = Object.freeze({
  /** Up the left flank, loop over the top. */
  LEFT_LOOP: bake([
    [-1.5, ROWS + 1],
    [1.2, ROWS - 4],
    [2.0, ROWS - 9],
    [1.6, 4.5],
    [MID - 2.2, 1.6],
    [MID, 3.0]
  ]),

  /** Mirror of LEFT_LOOP. */
  RIGHT_LOOP: bake([
    [COLS + 1.5, ROWS + 1],
    [COLS - 1.2, ROWS - 4],
    [COLS - 2.0, ROWS - 9],
    [COLS - 1.6, 4.5],
    [MID + 2.2, 1.6],
    [MID, 3.0]
  ]),

  /** Straight down the middle from above, then a wide fan out and back. */
  TOP_FAN: bake([
    [MID, -2],
    [MID, 3.2],
    [MID - 3.4, 6.4],
    [MID - 1.0, 8.4],
    [MID + 1.6, 5.6],
    [MID, 3.0]
  ]),

  /** Mirror of TOP_FAN. */
  TOP_FAN_MIRROR: bake([
    [MID, -2],
    [MID, 3.2],
    [MID + 3.4, 6.4],
    [MID + 1.0, 8.4],
    [MID - 1.6, 5.6],
    [MID, 3.0]
  ])
});

export const ENTRY_ORDER = Object.freeze([
  'LEFT_LOOP', 'RIGHT_LOOP', 'TOP_FAN', 'TOP_FAN_MIRROR'
]);

/**
 * DIVE paths. RELATIVE offsets from the slot the enemy peels out of.
 *
 * Every one of them ends below the bottom of the screen — that is the contract
 * enemies.js relies on to know a pass is over and the enemy should wrap to the
 * top. The y offsets are generous for that reason: a slot on the bottom
 * formation row is already at y ~7, so +16 clears ROWS with room to spare.
 */
export const DIVE_PATHS = Object.freeze({
  /** Peel left, sweep across, exit bottom-right. */
  PEEL: bake([
    [0, 0],
    [-1.8, 0.9],
    [-2.4, 3.0],
    [-0.6, 5.4],
    [2.2, 8.6],
    [3.0, 13.0],
    [2.2, 17.0]
  ]),

  /** A tight loop before committing, which buys the player a moment. */
  LOOP: bake([
    [0, 0],
    [1.6, 0.6],
    [2.0, 2.2],
    [0.4, 2.8],
    [-0.9, 4.6],
    [-1.4, 8.6],
    [-0.6, 13.0],
    [0.2, 17.0]
  ]),

  /** Almost straight down. The one that catches a player who stopped moving. */
  PLUNGE: bake([
    [0, 0],
    [0.2, 2.4],
    [-0.5, 5.6],
    [0.3, 9.8],
    [-0.2, 17.0]
  ]),

  /** Wide arc that crosses the whole screen. */
  SWEEP: bake([
    [0, 0],
    [2.4, 1.4],
    [3.6, 4.2],
    [1.2, 7.0],
    [-2.6, 9.6],
    [-3.4, 13.4],
    [-2.6, 17.0]
  ])
});

export const DIVE_ORDER = Object.freeze(['PEEL', 'LOOP', 'PLUNGE', 'SWEEP']);

/**
 * A boss's capture run: dive to the beam row and STOP there.
 *
 * Unlike the others this path deliberately does not leave the screen, because
 * the boss has to hold station while the beam is open. capture.js flies it back
 * up manually once the beam closes.
 */
export const CAPTURE_PATH = bake([
  [0, 0],
  [0.8, 2.0],
  [-0.8, 4.4],
  [0, 7.0],
  [0, 9.0]
]);
