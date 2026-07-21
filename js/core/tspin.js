/**
 * T-spin classification — spec §8.
 *
 * The 3-corner rule, done properly. v1 was wrong in two ways and both are fixed
 * here:
 *
 *   1. Its "last action was a rotation" flag was never cleared by a gravity
 *      drop, so rotate -> fall -> lock scored as a T-spin. The caller is now
 *      required to reset lastAction on ANY translation, gravity included, and
 *      this module simply trusts that contract.
 *
 *   2. It collapsed the rule to "3 corners occupied = T-spin", with no
 *      distinction between the T's front and back corners. That over-awards
 *      mini T-spins as full ones. Front/back is derived from the rotation state
 *      below.
 *
 * The rule:
 *   - The piece must be a T, and the last action must have been a rotation.
 *   - At least 3 of the 4 box corners must be occupied.
 *   - Both FRONT corners occupied  -> full T-spin.
 *   - Only one front corner        -> mini, unless the rotation needed the last
 *                                     kick offset, which promotes it to full.
 */

import { STATE_SPAWN, STATE_R, STATE_180, STATE_L } from './constants.js';
import { cornerOccupancy } from './piece.js';
import { TSPIN_NONE, TSPIN_MINI, TSPIN_FULL } from './scoring.js';

/**
 * Which of the four corners are "front" — the two the T's stem points between.
 *
 * cornerOccupancy returns [topLeft, topRight, bottomLeft, bottomRight]. In
 * spawn state the stem points up, so the front corners are the top two; each
 * quarter turn rotates which pair is in front.
 */
const FRONT_CORNERS = Object.freeze({
  [STATE_SPAWN]: [0, 1],  // stem up    -> top-left, top-right
  [STATE_R]:     [1, 3],  // stem right -> top-right, bottom-right
  [STATE_180]:   [2, 3],  // stem down  -> bottom-left, bottom-right
  [STATE_L]:     [0, 2]   // stem left  -> top-left, bottom-left
});

/** Index of the final kick offset, which promotes a mini to a full T-spin. */
const LAST_KICK_INDEX = 4;

/**
 * Classifies the lock that is about to happen.
 *
 * `lastAction` must be 'rotate' only if the most recent successful action was a
 * rotation — see the contract note above.
 */
export function classifyTSpin({ board, piece, lastAction, kickIndex }) {
  if (!piece || piece.type !== 'T') return TSPIN_NONE;
  if (lastAction !== 'rotate') return TSPIN_NONE;

  const corners = cornerOccupancy(board, piece);
  const occupied = corners.reduce((n, filled) => n + (filled ? 1 : 0), 0);
  if (occupied < 3) return TSPIN_NONE;

  const [frontA, frontB] = FRONT_CORNERS[piece.state];
  const frontCount = (corners[frontA] ? 1 : 0) + (corners[frontB] ? 1 : 0);

  if (frontCount === 2) return TSPIN_FULL;

  // One front corner: a mini, unless the rotation only succeeded on the last
  // kick offset — the standard override that makes TST and fin spins score
  // as full T-spins.
  return kickIndex === LAST_KICK_INDEX ? TSPIN_FULL : TSPIN_MINI;
}
