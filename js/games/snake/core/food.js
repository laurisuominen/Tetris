/**
 * Food placement.
 *
 * The obvious implementation is rejection sampling — pick a random cell, retry
 * if the snake is on it. It is also the one that hangs the game: with 399 of
 * 400 cells occupied, each attempt has a 1-in-400 chance of landing, so the
 * expected retry count runs to hundreds and the worst case is unbounded. A
 * player who is actually good at Snake is the one it fails for.
 *
 * Instead: count the free cells, pick k uniformly in [0, free), and walk to the
 * kth free cell. Two passes over 400 bytes, no branching on luck, and it is
 * exactly uniform. This runs once per apple, not once per frame.
 */

/**
 * @param {Uint8Array} occupied cell -> 1 if part of the snake
 * @param {() => number} rand seeded generator returning [0, 1)
 * @returns {number} cell index, or -1 if the board is full
 */
export function spawnFood(occupied, rand) {
  let free = 0;
  for (let i = 0; i < occupied.length; i++) {
    if (occupied[i] === 0) free += 1;
  }

  // Board full. The caller reads this as a win, not as an error.
  if (free === 0) return -1;

  let k = Math.floor(rand() * free);
  for (let i = 0; i < occupied.length; i++) {
    if (occupied[i] === 0) {
      if (k === 0) return i;
      k -= 1;
    }
  }

  // Unreachable: k < free and the second pass visits exactly `free` cells.
  return -1;
}
