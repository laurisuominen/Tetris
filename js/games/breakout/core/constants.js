/**
 * Dimensionless Breakout constants.
 *
 * COORDINATE CONVENTION — one system only.
 *
 *   Cell space (+y DOWN)   (0,0) is the top-left corner of the playfield.
 *                          Positions are FRACTIONAL: the ball and paddle sit
 *                          wherever they sit. Only the brick lattice is
 *                          integral. This is the virtual simulation grid from
 *                          CLAUDE.md's table; it is projected to CSS pixels at
 *                          draw time by multiplying by the fitted cell size,
 *                          and nothing in core/ knows that number exists.
 *
 * Every speed here is in CELLS PER SECOND, never pixels — a pixel speed would
 * make the game play differently on different screens, which is the whole
 * reason the virtual grid exists.
 */

/* --- playfield ------------------------------------------------------------- */

export const COLS = 28;
export const ROWS = 32;

/** A brick is two cells wide and one tall, so a row holds 14 of them. */
export const BRICK_COLS = 14;
export const BRICK_ROWS = 8;
export const BRICK_W = COLS / BRICK_COLS;   // 2 cells
export const BRICK_H = 1;
export const BRICK_COUNT = BRICK_COLS * BRICK_ROWS;

/** Linear index of a brick. The one place row,col becomes a single number. */
export const brickIndex = (row, col) => row * BRICK_COLS + col;

/**
 * First brick row, measured from the top wall.
 *
 * The gap above the wall is not decoration. Breaking through to it is the
 * game's one big moment — the ball rattles along the ceiling clearing the
 * expensive rows from behind — and it is also what the classic paddle-shrink
 * rule keys off. With the wall flush to the ceiling there is nothing to break
 * through TO.
 */
export const BRICK_TOP = 4;

/* --- ball ------------------------------------------------------------------ */

export const BALL_RADIUS = 0.35;

/**
 * The loop's fixed timestep. Unlike Snake this IS the simulation rate: the ball
 * moves every step rather than on an accumulator, because its motion is
 * continuous. createLoop demands a constant timestep and throws otherwise.
 */
export const TIMESTEP_MS = 1000 / 60;

/**
 * Hard cap on ball speed, in cells per second.
 *
 * 48 cells/s is 0.8 cells of travel per 16.7ms step — under one brick height,
 * which is what keeps the swept solver's work bounded (it can cross at most a
 * couple of surfaces per step). The cited guidance is to keep per-frame travel
 * well inside the smallest object; swept collision means exceeding that is a
 * performance question rather than a correctness one, but there is no reason to
 * find out where it stops being true.
 *
 * This number feeds the anti-cheat ceiling in
 * supabase/functions/submit-score/index.ts. Changing it means recomputing that.
 */
export const MAX_BALL_SPEED = 48;

/**
 * Deflection at the very edge of the paddle, in radians (60 degrees).
 *
 * This single number IS the angle clamp. A hit at the paddle's edge leaves at
 * 60 degrees off vertical, i.e. 30 degrees above horizontal, and no hit can
 * produce anything shallower. Near-horizontal trajectories are the classic
 * Breakout failure — the ball trolley-cars between the side walls while the
 * player waits — and because axis-aligned reflection only flips signs, the
 * angle set here is the angle the ball keeps until it returns to the paddle.
 */
export const MAX_DEFLECT_RAD = (60 * Math.PI) / 180;

/**
 * Safety valve on the collision resolution loop, mirroring Snake's
 * MAX_MOVES_PER_STEP. The geometry admits about three collisions in 0.8 cells;
 * eight is slack, and it turns a hypothetical infinite loop into a dropped
 * bounce.
 */
export const MAX_COLLISIONS_PER_STEP = 8;

/* --- paddle ---------------------------------------------------------------- */

export const PADDLE_Y = 30;
export const PADDLE_H = 0.6;
export const PADDLE_W = 4;
/** Halved by the classic break-through rule. */
export const PADDLE_W_SMALL = PADDLE_W / 2;

/** Keyboard paddle speed and how fast it gets there, in cells/s and cells/s². */
export const PADDLE_SPEED = 34;
export const PADDLE_ACCEL = 260;

/* --- lives, levels, timing ------------------------------------------------- */

export const START_LIVES = 3;

/**
 * Levels are capped so the maximum score is finite and the anti-cheat ceiling
 * can be derived rather than guessed. 99 is far past any real run; clearing it
 * is the win state.
 */
export const MAX_LEVEL = 99;

/** Pause between clearing a screen and the next one appearing. */
export const LEVEL_CLEAR_MS = 900;

/* --- speed tiers ----------------------------------------------------------- */

export const SPEEDS = Object.freeze({
  CALM: 'CALM',
  CLASSIC: 'CLASSIC',
  FRANTIC: 'FRANTIC'
});

/**
 * Per-tier starting ball speed in cells/second.
 *
 * Unlike Snake there is no score multiplier per tier. Breakout's points come
 * from bricks, and a brick is worth what the original said it is worth; making
 * Frantic bricks worth more would break the property that clearing the first
 * screen scores exactly the classic 448.
 */
export const SPEED_TABLE = Object.freeze({
  [SPEEDS.CALM]:    Object.freeze({ baseSpeed: 17, label: 'Calm' }),
  [SPEEDS.CLASSIC]: Object.freeze({ baseSpeed: 21, label: 'Classic' }),
  [SPEEDS.FRANTIC]: Object.freeze({ baseSpeed: 26, label: 'Frantic' })
});

/**
 * The 1976 speed-up rule: the ball gets faster after the 4th brick, after the
 * 12th, and on first contact with the orange and then the red rows. Four steps
 * of x1.12 is x1.57 over a screen.
 */
export const SPEEDUP_FACTOR = 1.12;
export const SPEEDUP_AT_HITS = Object.freeze([4, 12]);

/** Each new screen starts this much faster than the last. */
export const LEVEL_SPEED_FACTOR = 1.06;

/* --- bricks ---------------------------------------------------------------- */

/**
 * Row values, top row first: two red, two orange, two green, two yellow.
 *
 * The original counts them bottom-up as yellow 1, green 3, orange 5, red 7;
 * this array is top-down because that is the order rows are drawn and indexed.
 * A full screen is 14 x 2 x (7+5+3+1) = 448, which is the documented per-screen
 * total, and two screens is the documented maximum of 896.
 */
export const ROW_POINTS = Object.freeze([7, 7, 5, 5, 3, 3, 1, 1]);

/** Rows whose first contact triggers a speed-up, per the classic rule. */
export const SPEEDUP_ROW_POINTS = Object.freeze([7, 5]);

/**
 * The score multiplier is the level number, capped here.
 *
 * The cap exists for one reason: without it the maximum score is unbounded and
 * the Edge Function's ceiling cannot be derived. It is not a game-design
 * choice, and the derivation in submit-score/index.ts depends on it.
 */
export const SCORE_MULTIPLIER_CAP = 20;
