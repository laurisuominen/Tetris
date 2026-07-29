/**
 * The snake's body: a ring buffer of segments plus an occupancy grid.
 *
 * WHY TWO STRUCTURES FOR ONE SNAKE
 *
 * The ring buffer answers "where is each segment, in order" — needed to draw
 * the snake and to find the tail. The occupancy grid answers "is cell N part of
 * the snake" in O(1) — needed once per move for self-collision. A linear scan
 * of the segments would answer the second question too, and at 400 cells it
 * would be fast enough; the grid is here because it is also free, and because
 * CLAUDE.md requires pre-allocated pools with no allocation inside the loop.
 *
 * Both are allocated once at createGame and never reallocated. A move writes
 * two integers and flips at most two bytes.
 *
 * RING BUFFER LAYOUT
 *
 * `head` is the slot holding the head segment. Each move advances it by one,
 * wrapping at CELL_COUNT. The tail is `length - 1` slots behind. Slots outside
 * [tail, head] hold stale coordinates and must never be read — `length` is the
 * only thing that says which are live.
 *
 * The buffer is exactly CELL_COUNT long because that is the longest a snake can
 * ever be: a body covering every cell. It cannot overflow.
 */

import { CELL_COUNT, cellIndex, DIRECTIONS } from './constants.js';

export function createBody() {
  return {
    segX: new Int16Array(CELL_COUNT),
    segY: new Int16Array(CELL_COUNT),
    /** 1 where a segment sits, indexed by cellIndex(x, y). */
    occupied: new Uint8Array(CELL_COUNT),
    head: 0,
    length: 0
  };
}

/** Buffer slot of the tail segment. */
export function tailSlot(body) {
  return (body.head - body.length + 1 + CELL_COUNT) % CELL_COUNT;
}

/** Buffer slot of the nth segment back from the head (0 = head). */
export function slotOf(body, n) {
  return (body.head - n + CELL_COUNT) % CELL_COUNT;
}

export const headX = (body) => body.segX[body.head];
export const headY = (body) => body.segY[body.head];
export const tailX = (body) => body.segX[tailSlot(body)];
export const tailY = (body) => body.segY[tailSlot(body)];

/** Appends a segment at the head end. Used to build a snake, not to move one. */
function push(body, x, y) {
  body.head = body.length === 0 ? 0 : (body.head + 1) % CELL_COUNT;
  body.segX[body.head] = x;
  body.segY[body.head] = y;
  body.occupied[cellIndex(x, y)] = 1;
  body.length += 1;
}

/**
 * Rebuilds the snake in place, keeping the same typed arrays.
 *
 * Segments are laid tail-first so buffer order matches move order from the
 * outset: the oldest slot holds the tail, exactly as it will after a move.
 */
export function resetBody(body, { headX: hx, headY: hy, direction, length }) {
  body.occupied.fill(0);
  body.head = 0;
  body.length = 0;

  const { dx, dy } = DIRECTIONS[direction];
  for (let i = length - 1; i >= 0; i--) {
    push(body, hx - dx * i, hy - dy * i);
  }
}

/**
 * Whether moving into `index` collides with the snake.
 *
 * `tailVacating` is the whole subtlety. On a move that does not eat, the tail
 * leaves its cell at the same instant the head arrives, so moving into that
 * cell is legal — a snake may chase its own tail forever. On a move that eats,
 * the tail stays put and the same move is fatal.
 *
 * Getting this wrong is the classic Snake bug: the snake dies at full speed for
 * no visible reason, because the cell it entered looked occupied for one tick.
 */
export function hitsBody(body, index, tailVacating) {
  if (body.occupied[index] === 0) return false;
  if (!tailVacating) return true;
  return index !== cellIndex(tailX(body), tailY(body));
}

/**
 * Commits a move to (x, y).
 *
 * Order matters: the tail is released before the head is written, so a snake
 * moving into its own vacated tail cell leaves that cell marked occupied rather
 * than accidentally clearing it.
 */
export function advanceHead(body, x, y, grow) {
  if (!grow) {
    body.occupied[cellIndex(tailX(body), tailY(body))] = 0;
    body.length -= 1;
  }

  body.head = (body.head + 1) % CELL_COUNT;
  body.segX[body.head] = x;
  body.segY[body.head] = y;
  body.occupied[cellIndex(x, y)] = 1;
  body.length += 1;
}
