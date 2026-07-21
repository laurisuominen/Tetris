/**
 * 7-bag randomizer and the next queue — spec §5.
 *
 * Every bag is a shuffled permutation of all seven pieces, dealt out before the
 * next bag is generated. This bounds the worst-case drought at 12 pieces and is
 * what stops the long same-piece runs a naive random picker produces.
 *
 * The queue keeps at least NEXT_COUNT + 7 pieces buffered so the 5-piece
 * preview is always full, including immediately after a pull.
 */

import { PIECE_TYPES, NEXT_COUNT } from './constants.js';
import { shuffle } from './rng.js';

const MIN_BUFFERED = NEXT_COUNT + 7;

function refill(pieces, rand) {
  const out = pieces.slice();
  while (out.length < MIN_BUFFERED) {
    out.push(...shuffle(PIECE_TYPES, rand));
  }
  return out;
}

/** A queue is `{ pieces }` — a plain array of upcoming piece types. */
export function createQueue(rand) {
  return Object.freeze({ pieces: Object.freeze(refill([], rand)) });
}

/** The next `count` upcoming types, without consuming them. */
export function peek(queue, count = NEXT_COUNT) {
  return queue.pieces.slice(0, count);
}

/** Takes the next type, returning it alongside the advanced queue. */
export function pull(queue, rand) {
  const [type, ...rest] = queue.pieces;
  return {
    type,
    queue: Object.freeze({ pieces: Object.freeze(refill(rest, rand)) })
  };
}
