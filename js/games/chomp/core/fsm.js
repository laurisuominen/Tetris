/**
 * Game state machine.
 *
 * Same table shape as the other four games, including the MENU/RESTART row that
 * Snake shipped without and which made its Play button do nothing.
 *
 * Chomp has three moments that look like states and are NOT: the "Ready" pause,
 * the death animation, and the gap between boards. All three are timers inside
 * PLAYING, because each accepts exactly the same input as the moments either
 * side of it. A state you can be in for 1.6 seconds that changes no input
 * handling is a flag — see core/game.js.
 */

export const STATES = Object.freeze({
  BOOT: 'BOOT',
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  GAME_OVER: 'GAME_OVER'
});

export const EVENTS = Object.freeze({
  START: 'START',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  DIE: 'DIE',
  RESTART: 'RESTART',
  TO_MENU: 'TO_MENU',
  BLUR: 'BLUR'
});

const { BOOT, MENU, PLAYING, PAUSED, GAME_OVER } = STATES;
const E = EVENTS;

const TABLE = Object.freeze({
  [BOOT]: Object.freeze({ [E.START]: PLAYING, [E.TO_MENU]: MENU }),
  [MENU]: Object.freeze({ [E.START]: PLAYING, [E.RESTART]: PLAYING }),
  [PLAYING]: Object.freeze({
    [E.PAUSE]: PAUSED,
    [E.BLUR]: PAUSED,
    [E.DIE]: GAME_OVER,
    [E.RESTART]: PLAYING,
    [E.TO_MENU]: MENU
  }),
  [PAUSED]: Object.freeze({
    [E.RESUME]: PLAYING,
    [E.PAUSE]: PLAYING,
    [E.RESTART]: PLAYING,
    [E.TO_MENU]: MENU
  }),
  [GAME_OVER]: Object.freeze({ [E.RESTART]: PLAYING, [E.TO_MENU]: MENU })
});

export function transition(state, event) {
  const row = TABLE[state];
  if (!row) throw new Error(`unknown state: ${state}`);
  return row[event] ?? state;
}

export function acceptsGameplayInput(state) {
  return state === PLAYING;
}

export function isRunning(state) {
  return state === PLAYING;
}
