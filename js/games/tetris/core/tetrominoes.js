/**
 * Tetromino shape data — spec §3.
 *
 * All four orientations of every piece are stored explicitly rather than being
 * derived by rotating a matrix at runtime. Rotation is therefore an index
 * change, `(state + 1) % 4`, and never a transform.
 *
 * This is deliberate. v1 rotated matrices and had to special-case the O (2x2)
 * and I (4x4) bounding boxes, which produced a shape declared twice and
 * overwritten mid-file. Explicit data cannot drift.
 *
 * Offsets are (x, y) within the piece's NxN bounding box, +x right and +y UP,
 * origin at the box's bottom-left. This matches the convention the SRS kick
 * tables are authored in. The single conversion to board space lives in
 * piece.js — see constants.js for the full explanation.
 */

import { COLS } from './constants.js';

/** Bounding box edge length per piece. Rotation happens within this box. */
export const BOX_SIZE = Object.freeze({
  I: 4, O: 2, J: 3, L: 3, S: 3, T: 3, Z: 3
});

const freezeStates = (states) =>
  Object.freeze(states.map((cells) =>
    Object.freeze(cells.map(([x, y]) => Object.freeze({ x, y })))
  ));

/**
 * SHAPES[type][state] -> readonly array of {x, y} offsets.
 * States are ordered 0 (spawn), R (one CW), 2 (180), L (one CCW).
 *
 * The ASCII beside each state is the box as it appears on screen, so these can
 * be checked by eye against any guideline diagram.
 */
export const SHAPES = Object.freeze({
  //  .T.      .T.      ...      .T.
  //  TTT      .TT      TTT      TT.
  //  ...      .T.      .T.      .T.
  T: freezeStates([
    [[1, 2], [0, 1], [1, 1], [2, 1]],
    [[1, 2], [1, 1], [2, 1], [1, 0]],
    [[0, 1], [1, 1], [2, 1], [1, 0]],
    [[1, 2], [0, 1], [1, 1], [1, 0]]
  ]),

  //  J..      .JJ      ...      .J.
  //  JJJ      .J.      JJJ      .J.
  //  ...      .J.      ..J      JJ.
  J: freezeStates([
    [[0, 2], [0, 1], [1, 1], [2, 1]],
    [[1, 2], [2, 2], [1, 1], [1, 0]],
    [[0, 1], [1, 1], [2, 1], [2, 0]],
    [[1, 2], [1, 1], [0, 0], [1, 0]]
  ]),

  //  ..L      .L.      ...      LL.
  //  LLL      .L.      LLL      .L.
  //  ...      .LL      L..      .L.
  L: freezeStates([
    [[2, 2], [0, 1], [1, 1], [2, 1]],
    [[1, 2], [1, 1], [1, 0], [2, 0]],
    [[0, 1], [1, 1], [2, 1], [0, 0]],
    [[0, 2], [1, 2], [1, 1], [1, 0]]
  ]),

  //  .SS      .S.      ...      S..
  //  SS.      .SS      .SS      SS.
  //  ...      ..S      SS.      .S.
  S: freezeStates([
    [[1, 2], [2, 2], [0, 1], [1, 1]],
    [[1, 2], [1, 1], [2, 1], [2, 0]],
    [[1, 1], [2, 1], [0, 0], [1, 0]],
    [[0, 2], [0, 1], [1, 1], [1, 0]]
  ]),

  //  ZZ.      ..Z      ...      .Z.
  //  .ZZ      .ZZ      ZZ.      ZZ.
  //  ...      .Z.      .ZZ      Z..
  Z: freezeStates([
    [[0, 2], [1, 2], [1, 1], [2, 1]],
    [[2, 2], [1, 1], [2, 1], [1, 0]],
    [[0, 1], [1, 1], [1, 0], [2, 0]],
    [[1, 2], [0, 1], [1, 1], [0, 0]]
  ]),

  //  ....     ..I.     ....     .I..
  //  IIII     ..I.     ....     .I..
  //  ....     ..I.     IIII     .I..
  //  ....     ..I.     ....     .I..
  I: freezeStates([
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[2, 3], [2, 2], [2, 1], [2, 0]],
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[1, 3], [1, 2], [1, 1], [1, 0]]
  ]),

  //  OO       identical in all four states — the O never rotates and never kicks
  //  OO
  O: freezeStates([
    [[0, 1], [1, 1], [0, 0], [1, 0]],
    [[0, 1], [1, 1], [0, 0], [1, 0]],
    [[0, 1], [1, 1], [0, 0], [1, 0]],
    [[0, 1], [1, 1], [0, 0], [1, 0]]
  ])
});

/**
 * Spawn position — the board-space (y down) coordinate of the bounding box's
 * TOP-LEFT corner.
 *
 * Spec §3 puts I across columns 3-6 and the 3-wide pieces on columns 3-5. The O
 * is 2 wide and cannot straddle three columns, so it takes the guideline's 4-5.
 *
 * SPAWN_ROW places the piece's horizontal bar on the first visible row rather
 * than hiding it in the buffer. The guideline technically spawns just above the
 * visible field, but a piece the player cannot see for its first drop reads as a
 * bug, and this keeps block-out detection meaning what it says: if the spawn
 * cells are taken, the stack has genuinely reached the top.
 */
const SPAWN_ROW = 20;

export const SPAWN = Object.freeze({
  I: Object.freeze({ x: 3, y: SPAWN_ROW }),
  J: Object.freeze({ x: 3, y: SPAWN_ROW }),
  L: Object.freeze({ x: 3, y: SPAWN_ROW }),
  O: Object.freeze({ x: 4, y: SPAWN_ROW }),
  S: Object.freeze({ x: 3, y: SPAWN_ROW }),
  T: Object.freeze({ x: 3, y: SPAWN_ROW }),
  Z: Object.freeze({ x: 3, y: SPAWN_ROW })
});

/**
 * CSS custom property holding each piece's colour. Core exports token *names*,
 * never hex — the actual values live in css/tokens.css so there is one source
 * of truth, and core stays free of presentation concerns.
 */
export const COLOR_TOKENS = Object.freeze({
  I: '--piece-i', J: '--piece-j', L: '--piece-l', O: '--piece-o',
  S: '--piece-s', T: '--piece-t', Z: '--piece-z'
});

/** Offsets for the given type and rotation state. */
export function shapeOf(type, state) {
  return SHAPES[type][state];
}

// Guard against a typo in the tables above silently shipping a 3-cell piece.
for (const [type, states] of Object.entries(SHAPES)) {
  if (states.length !== 4) throw new Error(`${type} needs 4 rotation states`);
  for (const cells of states) {
    if (cells.length !== 4) throw new Error(`${type} has a state without 4 cells`);
    for (const { x, y } of cells) {
      if (x < 0 || x >= BOX_SIZE[type] || y < 0 || y >= BOX_SIZE[type]) {
        throw new Error(`${type} has a cell outside its bounding box`);
      }
    }
  }
}

if (SPAWN.I.x + BOX_SIZE.I > COLS) throw new Error('I spawns out of bounds');
