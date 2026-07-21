/**
 * The active piece and its derived cells.
 *
 * A piece is `{ type, state, x, y }` where (x, y) is the board-space position of
 * its bounding box's TOP-LEFT corner. Pieces are plain frozen objects; every
 * operation returns a new one.
 *
 * THIS MODULE OWNS THE COORDINATE SEAM. `toBoardCells` is the one and only
 * place where the +y-up piece/kick convention meets the +y-down board. If you
 * find a y being negated anywhere else in core/, it is a bug.
 */

import { STATE_SPAWN } from './constants.js';
import { SHAPES, BOX_SIZE, SPAWN } from './tetrominoes.js';
import { collides, isOccupied } from './board.js';

export function createPiece(type, state = STATE_SPAWN, x = null, y = null) {
  const spawn = SPAWN[type];
  return Object.freeze({
    type,
    state,
    x: x === null ? spawn.x : x,
    y: y === null ? spawn.y : y
  });
}

/**
 * Absolute board cells occupied by a piece.
 *
 * Shape offsets are (ox, oy) within an N-box with +y up and origin bottom-left.
 * The piece position is the box's top-left in board space with +y down. So the
 * row of a cell is measured from the box top: `y + (N - 1 - oy)`.
 */
export function toBoardCells(piece) {
  const size = BOX_SIZE[piece.type];
  const offsets = SHAPES[piece.type][piece.state];
  const cells = new Array(offsets.length);
  for (let i = 0; i < offsets.length; i++) {
    cells[i] = {
      col: piece.x + offsets[i].x,
      row: piece.y + (size - 1 - offsets[i].y)
    };
  }
  return cells;
}

export function translated(piece, dx, dy) {
  return Object.freeze({ ...piece, x: piece.x + dx, y: piece.y + dy });
}

export function withState(piece, state) {
  return Object.freeze({ ...piece, state });
}

/** Whether a piece sits in a legal position on the board. */
export function isValid(board, piece) {
  return !collides(board, toBoardCells(piece));
}

/** Whether a piece can shift by (dx, dy). dy is in board space, so +1 is down. */
export function canMove(board, piece, dx, dy) {
  return isValid(board, translated(piece, dx, dy));
}

/** Whether the piece is resting on the stack or the floor. */
export function isGrounded(board, piece) {
  return !canMove(board, piece, 0, 1);
}

/** How many rows the piece would fall on a hard drop. */
export function dropDistance(board, piece) {
  let distance = 0;
  while (canMove(board, piece, 0, distance + 1)) distance++;
  return distance;
}

/** The piece translated to its hard-drop landing position — spec §7. */
export function ghostOf(board, piece) {
  return translated(piece, 0, dropDistance(board, piece));
}

/**
 * Occupancy of the four corners of a T piece's 3x3 box, in board space.
 * Used by T-spin classification; lives here because it is pure geometry.
 * Order is [topLeft, topRight, bottomLeft, bottomRight].
 */
export function cornerOccupancy(board, piece) {
  const size = BOX_SIZE[piece.type];
  const right = piece.x + size - 1;
  const bottom = piece.y + size - 1;
  return [
    isOccupied(board, piece.x, piece.y),
    isOccupied(board, right, piece.y),
    isOccupied(board, piece.x, bottom),
    isOccupied(board, right, bottom)
  ];
}
