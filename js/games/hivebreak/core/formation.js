/**
 * The formation grid: where a slot sits, and how the whole block breathes.
 *
 * The sway is ONE oscillator on the formation, not per-enemy state. That is
 * deliberate and it is what keeps the block reading as a single organism —
 * give each enemy its own phase and the formation shimmers instead of
 * breathing. It also means the sway costs one sin() per step rather than forty.
 *
 * Slots are addressed by index, row-major, so slot -> (row, col) is division
 * and a remainder rather than a stored pair.
 */

import {
  FORMATION_COLS, FORMATION_ROWS, FORMATION_GAP_X, FORMATION_GAP_Y,
  FORMATION_ORIGIN_X, FORMATION_ORIGIN_Y, BREATHE_AMPLITUDE, BREATHE_PERIOD_S,
  ROW_KINDS, BOSS_COLUMNS, KIND
} from './constants.js';

export const rowOfSlot = (slot) => Math.floor(slot / FORMATION_COLS);
export const colOfSlot = (slot) => slot % FORMATION_COLS;

/** The kind that belongs in a slot, or null if the slot is never occupied. */
export function kindOfSlot(slot) {
  const row = rowOfSlot(slot);
  const kind = ROW_KINDS[row];
  if (kind === KIND.BOSS && !BOSS_COLUMNS.includes(colOfSlot(slot))) return null;
  return kind ?? null;
}

/** Every slot that holds an enemy at the start of a wave. */
export function occupiedSlots() {
  const slots = [];
  for (let slot = 0; slot < FORMATION_COLS * FORMATION_ROWS; slot += 1) {
    if (kindOfSlot(slot) !== null) slots.push(slot);
  }
  return slots;
}

/**
 * The sway offset in tiles at a given elapsed time.
 *
 * A plain sine. Triangle waves were tried and read as mechanical — the pause
 * at each extreme of a sine is what makes it look like breathing.
 */
export function breatheOffset(elapsedS) {
  return Math.sin((elapsedS / BREATHE_PERIOD_S) * Math.PI * 2) * BREATHE_AMPLITUDE;
}

/** X of a slot, including the current sway. */
export function slotX(slot, offset) {
  return FORMATION_ORIGIN_X + colOfSlot(slot) * FORMATION_GAP_X + offset;
}

/** Y of a slot. The formation does not move vertically. */
export function slotY(slot) {
  return FORMATION_ORIGIN_Y + rowOfSlot(slot) * FORMATION_GAP_Y;
}
