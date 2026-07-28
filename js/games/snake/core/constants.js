/**
 * Dimensionless Snake constants.
 *
 * COORDINATE CONVENTION — one system only, unlike Tetris.
 *
 *   Grid space (+y DOWN)   Cell (0,0) is the top-left. The linear index of a
 *                          cell is `y * COLS + x`, which is how both the
 *                          occupancy grid and the food position are stored.
 *
 * There is no second convention and no conversion seam. If you find yourself
 * negating a y anywhere in core/, something has gone wrong.
 */

export const COLS = 20;
export const ROWS = 20;
export const CELL_COUNT = COLS * ROWS;

/** Linear index of a grid cell. The one place x,y becomes a single number. */
export const cellIndex = (x, y) => y * COLS + x;

/** Snake length at the start of a game, head included. */
export const START_LENGTH = 3;

/* Timing — all milliseconds. */

/**
 * The loop's fixed timestep. NOT the rate the snake moves at.
 *
 * createLoop demands a constant timestep and throws otherwise, so speed cannot
 * come from re-rating the loop. The snake's move cadence is an accumulator
 * inside the reducer instead — see moveIntervalMs in scoring.js — exactly the
 * way Tetris handles gravity.
 */
export const TIMESTEP_MS = 1000 / 60;

/**
 * How many turns may be buffered ahead of the snake.
 *
 * Reading one direction per move is what makes a fast up-then-left corner eat
 * an input and send the player straight into a wall. Two is enough for the
 * quickest human double-tap and small enough that the snake still feels like it
 * obeys you rather than replaying a macro.
 */
export const TURN_QUEUE_MAX = 2;

/* Speed tiers, in the Google Snake vocabulary players already know. */

export const SPEEDS = Object.freeze({
  TURTLE: 'TURTLE',
  SNAKE: 'SNAKE',
  RABBIT: 'RABBIT'
});

/**
 * Per-tier base move interval and score multiplier.
 *
 * The multiplier is what stops the slow tier from being the high-score tier:
 * a Turtle run has more thinking time per apple, so its apples are worth less.
 *
 * These numbers feed the anti-cheat ceiling derived in
 * supabase/functions/submit-score/index.ts. Changing one means recomputing that.
 */
export const SPEED_TABLE = Object.freeze({
  [SPEEDS.TURTLE]: Object.freeze({ baseIntervalMs: 200, multiplier: 1, label: 'Turtle' }),
  [SPEEDS.SNAKE]:  Object.freeze({ baseIntervalMs: 120, multiplier: 2, label: 'Snake' }),
  [SPEEDS.RABBIT]: Object.freeze({ baseIntervalMs:  70, multiplier: 3, label: 'Rabbit' })
});

/** Milliseconds shaved off the move interval per apple eaten. */
export const INTERVAL_STEP_MS = 1.5;

/** The interval never drops below this fraction of the tier's base. */
export const INTERVAL_FLOOR_RATIO = 0.5;

/** Points per apple before the tier multiplier. */
export const APPLE_BASE_POINTS = 10;

/* Directions. Frozen so a stray write cannot corrupt every future move. */

export const DIRECTIONS = Object.freeze({
  UP:    Object.freeze({ dx:  0, dy: -1 }),
  DOWN:  Object.freeze({ dx:  0, dy:  1 }),
  LEFT:  Object.freeze({ dx: -1, dy:  0 }),
  RIGHT: Object.freeze({ dx:  1, dy:  0 })
});

/**
 * The turn that would drive the snake back through its own neck.
 *
 * Rejecting these is not a convenience — a 180 with a body longer than one
 * segment is an instant self-collision, so without this the reverse key is a
 * suicide key.
 */
export const OPPOSITE = Object.freeze({
  UP: 'DOWN',
  DOWN: 'UP',
  LEFT: 'RIGHT',
  RIGHT: 'LEFT'
});
