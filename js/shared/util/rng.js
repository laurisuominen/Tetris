/**
 * Seedable randomness.
 *
 * Core never calls Math.random. Injecting the generator is what makes the bag,
 * and therefore an entire game, reproducible — which is what lets the
 * determinism test assert that 60Hz and 144Hz produce identical states.
 */

/**
 * mulberry32 — small, fast, and good enough for piece order. Not cryptographic,
 * and nothing here needs it to be.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates on a copy, using the supplied generator. */
export function shuffle(items, rand) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
