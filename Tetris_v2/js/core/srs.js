/**
 * Rotation with wall kicks — spec §4.
 *
 * This module converts kick offsets from the spec's +y-up convention into board
 * space. That negation appears exactly once, in `applyKick`, and is the reason
 * the kick tables can be transcribed from the spec without alteration.
 */

import { getKicks, targetState } from './kicks.js';
import { translated, withState, isValid } from './piece.js';

/**
 * Applies a +y-up kick offset to a piece in +y-down board space.
 *
 * A kick of +1 in spec space means "up", which is -1 in board rows. This is THE
 * conversion; see the header comment in constants.js.
 */
function applyKick(piece, [kickX, kickY]) {
  return translated(piece, kickX, -kickY);
}

/**
 * Attempts a rotation.
 *
 * Returns `{ piece, kickIndex }` for the first offset that lands in a valid
 * position, or `null` if every offset fails — in which case the rotation is
 * rejected and nothing moves, per spec §4.
 *
 * `kickIndex` is passed on to T-spin classification, which promotes a mini to a
 * full T-spin when the last offset was the one that worked.
 */
export function tryRotate(board, piece, direction) {
  const from = piece.state;
  const to = targetState(from, direction);
  if (to === from) return null;

  const rotated = withState(piece, to);
  const kicks = getKicks(piece.type, from, to);

  for (let i = 0; i < kicks.length; i++) {
    const candidate = applyKick(rotated, kicks[i]);
    if (isValid(board, candidate)) {
      return { piece: candidate, kickIndex: i };
    }
  }
  return null;
}
