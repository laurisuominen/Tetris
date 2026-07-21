/**
 * Dimensionless game constants.
 *
 * COORDINATE CONVENTIONS — read this before touching anything in core/.
 *
 * There are two, and exactly one seam between them:
 *
 *   Piece space (+y UP)    Used by tetromino offsets and the SRS kick tables,
 *                          because the spec authors them that way. Keeping the
 *                          spec's convention means kick offsets can be
 *                          transcribed verbatim with no mental arithmetic.
 *
 *   Board space (+y DOWN)  Used by the grid itself. Row 0 is the top of the
 *                          40-row buffer, index = row * COLS + col.
 *
 * The conversion happens in exactly one function, `toBoardCells` in piece.js.
 * board.js never sees a +y-up coordinate. If you find yourself negating a y
 * anywhere else, something has gone wrong.
 */

export const COLS = 10;
export const VISIBLE_ROWS = 20;
export const BUFFER_ROWS = 20;
export const TOTAL_ROWS = VISIBLE_ROWS + BUFFER_ROWS;
export const CELL_COUNT = COLS * TOTAL_ROWS;

export const NEXT_COUNT = 5;

/** Piece type -> cell ordinal stored in the board. 0 means empty. */
export const PIECE_TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
export const TYPE_TO_ORDINAL = Object.freeze(
  Object.fromEntries(PIECE_TYPES.map((type, i) => [type, i + 1]))
);
export const ORDINAL_TO_TYPE = Object.freeze([null, ...PIECE_TYPES]);

/* Rotation states — spec §4. Index into a piece's four orientations. */
export const STATE_SPAWN = 0;
export const STATE_R = 1;
export const STATE_180 = 2;
export const STATE_L = 3;

export const ROTATE_CW = 'CW';
export const ROTATE_CCW = 'CCW';
export const ROTATE_HALF = 'HALF';

/* Timing — all milliseconds. */
export const TIMESTEP_MS = 1000 / 60;
export const LOCK_DELAY_MS = 500;
export const MAX_LOCK_RESETS = 15;
export const LINE_CLEAR_MS = 300;
export const DAS_MS = 170;
export const ARR_MS = 50;

/** Soft drop is this many times faster than the current gravity — spec §6. */
export const SOFT_DROP_FACTOR = 20;

/** Floor on the gravity interval so sub-frame levels stay finite. */
export const MIN_DROP_INTERVAL_MS = 10;
