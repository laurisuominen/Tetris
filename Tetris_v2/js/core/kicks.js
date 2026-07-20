/**
 * SRS wall-kick tables — spec §4.
 *
 * Offsets are (x, y) with +x right and +y UP, exactly as the spec authors them,
 * so these are transcribed verbatim with no sign changes. The conversion to
 * board space happens once, in srs.js.
 *
 * On a rotation, each offset is tried in order until one lands the piece in a
 * valid position. If none does, the rotation fails and nothing moves.
 */

import {
  STATE_SPAWN, STATE_R, STATE_180, STATE_L,
  ROTATE_CW, ROTATE_CCW, ROTATE_HALF
} from './constants.js';

const t = (from, to) => `${from}->${to}`;

/** J, L, S, T, Z — spec §4. */
export const KICKS_JLSTZ = Object.freeze({
  [t(STATE_SPAWN, STATE_R)]: [[0, 0], [-1, 0], [-1, +1], [0, -2], [-1, -2]],
  [t(STATE_R, STATE_SPAWN)]: [[0, 0], [+1, 0], [+1, -1], [0, +2], [+1, +2]],
  [t(STATE_R, STATE_180)]:   [[0, 0], [+1, 0], [+1, -1], [0, +2], [+1, +2]],
  [t(STATE_180, STATE_R)]:   [[0, 0], [-1, 0], [-1, +1], [0, -2], [-1, -2]],
  [t(STATE_180, STATE_L)]:   [[0, 0], [+1, 0], [+1, +1], [0, -2], [+1, -2]],
  [t(STATE_L, STATE_180)]:   [[0, 0], [-1, 0], [-1, -1], [0, +2], [-1, +2]],
  [t(STATE_L, STATE_SPAWN)]: [[0, 0], [-1, 0], [-1, -1], [0, +2], [-1, +2]],
  [t(STATE_SPAWN, STATE_L)]: [[0, 0], [+1, 0], [+1, +1], [0, -2], [+1, -2]]
});

/** I piece — spec §4. Different enough to warrant its own table. */
export const KICKS_I = Object.freeze({
  [t(STATE_SPAWN, STATE_R)]: [[0, 0], [-2, 0], [+1, 0], [-2, -1], [+1, +2]],
  [t(STATE_R, STATE_SPAWN)]: [[0, 0], [+2, 0], [-1, 0], [+2, +1], [-1, -2]],
  [t(STATE_R, STATE_180)]:   [[0, 0], [-1, 0], [+2, 0], [-1, +2], [+2, -1]],
  [t(STATE_180, STATE_R)]:   [[0, 0], [+1, 0], [-2, 0], [+1, -2], [-2, +1]],
  [t(STATE_180, STATE_L)]:   [[0, 0], [+2, 0], [-1, 0], [+2, +1], [-1, -2]],
  [t(STATE_L, STATE_180)]:   [[0, 0], [-2, 0], [+1, 0], [-2, -1], [+1, +2]],
  [t(STATE_L, STATE_SPAWN)]: [[0, 0], [+1, 0], [-2, 0], [+1, -2], [-2, +1]],
  [t(STATE_SPAWN, STATE_L)]: [[0, 0], [-1, 0], [+2, 0], [-1, +2], [+2, -1]]
});

/**
 * 180° kicks.
 *
 * DELIBERATE EXTENSION BEYOND THE SPEC. Spec §10 mandates a 180° rotation key
 * but §4 gives no kick table for it, because the Tetris Guideline does not
 * define one. A kickless 180 is unusable in a real stack — it fails against any
 * adjacent surface — so this adopts the Nullpomino / TETR.IO table, which is
 * the de-facto standard.
 *
 * v1 shipped 180 rotation with no kicks at all. This is the fix, and it is
 * documented in the README as an extension rather than passed off as guideline.
 */
export const KICKS_180 = Object.freeze([
  [0, 0], [0, +1], [+1, +1], [-1, +1], [+1, 0], [-1, 0]
]);

/** The O never kicks — spec §4. Its only offset is a no-op. */
export const NO_KICK = Object.freeze([[0, 0]]);

/** Target rotation state for a direction. */
export function targetState(state, direction) {
  switch (direction) {
    case ROTATE_CW:   return (state + 1) % 4;
    case ROTATE_CCW:  return (state + 3) % 4;
    case ROTATE_HALF: return (state + 2) % 4;
    default: throw new Error(`unknown rotation direction: ${direction}`);
  }
}

/** Kick offsets to try, in order, for a given transition. */
export function getKicks(type, fromState, toState) {
  if (type === 'O') return NO_KICK;
  if (toState === (fromState + 2) % 4) return KICKS_180;
  return (type === 'I' ? KICKS_I : KICKS_JLSTZ)[t(fromState, toState)];
}

// A missing entry would silently make a rotation unkickable, so prove both
// tables cover all eight quarter-turn transitions with five offsets each.
for (const [name, table] of [['JLSTZ', KICKS_JLSTZ], ['I', KICKS_I]]) {
  const keys = Object.keys(table);
  if (keys.length !== 8) throw new Error(`${name} kick table needs 8 transitions`);
  for (const key of keys) {
    if (table[key].length !== 5) throw new Error(`${name} ${key} needs 5 offsets`);
  }
}
