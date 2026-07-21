/**
 * The playfield grid and pure operations on it.
 *
 * Representation: a flat Uint8Array of COLS * TOTAL_ROWS, where 0 is empty and
 * 1..7 is a piece ordinal (see TYPE_TO_ORDINAL). Flat beats nested arrays for
 * copy cost and cache behaviour, and makes deep equality in tests trivial.
 *
 * Board space only: row 0 is the top of the buffer, +y is DOWN. This module
 * never sees a +y-up coordinate — that conversion happens in piece.js.
 *
 * Operations return new boards rather than mutating. A copy is ~400 bytes,
 * which is irrelevant at 60Hz and buys straightforward testability.
 */

import {
  COLS, TOTAL_ROWS, CELL_COUNT, VISIBLE_ROWS, BUFFER_ROWS,
  TYPE_TO_ORDINAL
} from './constants.js';

export function createBoard() {
  return new Uint8Array(CELL_COUNT);
}

export function cloneBoard(board) {
  return Uint8Array.prototype.slice.call(board);
}

export const indexOf = (col, row) => row * COLS + col;

/** Cell ordinal at a position, or 0 when out of bounds. */
export function getCell(board, col, row) {
  if (col < 0 || col >= COLS || row < 0 || row >= TOTAL_ROWS) return 0;
  return board[indexOf(col, row)];
}

/**
 * Whether a cell blocks a piece.
 *
 * Walls and the floor block. Above the top does NOT block, so pieces may rotate
 * and kick up into the buffer rather than being clipped by it.
 */
export function isOccupied(board, col, row) {
  if (col < 0 || col >= COLS) return true;
  if (row >= TOTAL_ROWS) return true;
  if (row < 0) return false;
  return board[indexOf(col, row)] !== 0;
}

/** Whether any of the given board-space cells is blocked. */
export function collides(board, cells) {
  for (const { col, row } of cells) {
    if (isOccupied(board, col, row)) return true;
  }
  return false;
}

/** Writes cells into a copy of the board. */
export function lockCells(board, cells, type) {
  const ordinal = TYPE_TO_ORDINAL[type];
  const next = cloneBoard(board);
  for (const { col, row } of cells) {
    if (row >= 0 && row < TOTAL_ROWS && col >= 0 && col < COLS) {
      next[indexOf(col, row)] = ordinal;
    }
  }
  return next;
}

export function isRowFull(board, row) {
  const start = row * COLS;
  for (let col = 0; col < COLS; col++) {
    if (board[start + col] === 0) return false;
  }
  return true;
}

export function isRowEmpty(board, row) {
  const start = row * COLS;
  for (let col = 0; col < COLS; col++) {
    if (board[start + col] !== 0) return false;
  }
  return true;
}

/** Indices of every full row, ascending (topmost first). */
export function findFullRows(board) {
  const rows = [];
  for (let row = 0; row < TOTAL_ROWS; row++) {
    if (isRowFull(board, row)) rows.push(row);
  }
  return rows;
}

/**
 * Removes the given rows and drops everything above them down.
 *
 * Handles non-adjacent rows correctly by rebuilding bottom-up and skipping
 * cleared rows, rather than splicing repeatedly — spec §9 requires simultaneous
 * multi-row clears.
 */
export function removeRows(board, rowIndices) {
  if (rowIndices.length === 0) return board;

  const cleared = new Set(rowIndices);
  const next = createBoard();

  let writeRow = TOTAL_ROWS - 1;
  for (let readRow = TOTAL_ROWS - 1; readRow >= 0; readRow--) {
    if (cleared.has(readRow)) continue;
    next.set(board.subarray(readRow * COLS, readRow * COLS + COLS), writeRow * COLS);
    writeRow--;
  }
  // Rows above writeRow stay zeroed — they scrolled in empty from the top.
  return next;
}

/** Height of the highest occupied cell, measured from the floor. 0 when empty. */
export function stackHeight(board) {
  for (let row = 0; row < TOTAL_ROWS; row++) {
    if (!isRowEmpty(board, row)) return TOTAL_ROWS - row;
  }
  return 0;
}

/** Board row where the visible playfield begins. Rows above it are the buffer. */
export const FIRST_VISIBLE_ROW = BUFFER_ROWS;

/** Test helper: build a board from ASCII rows, bottom row last. '.' is empty. */
export function boardFromRows(rows, type = 'I') {
  const board = createBoard();
  const ordinal = TYPE_TO_ORDINAL[type];
  const top = TOTAL_ROWS - rows.length;
  rows.forEach((line, i) => {
    for (let col = 0; col < COLS; col++) {
      if (line[col] && line[col] !== '.') {
        board[indexOf(col, top + i)] = ordinal;
      }
    }
  });
  return board;
}

/** Test helper: render the visible playfield as ASCII, for readable failures. */
export function boardToRows(board, rowCount = VISIBLE_ROWS) {
  const out = [];
  for (let row = TOTAL_ROWS - rowCount; row < TOTAL_ROWS; row++) {
    let line = '';
    for (let col = 0; col < COLS; col++) {
      line += board[indexOf(col, row)] === 0 ? '.' : '#';
    }
    out.push(line);
  }
  return out;
}
