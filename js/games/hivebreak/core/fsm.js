/**
 * Game state machine.
 *
 * Same table shape as Snake's and Breakout's, including the MENU/RESTART row
 * that Snake originally shipped without — every route into a run goes through
 * one startNewGame() that dispatches RESTART, so RESTART has to be legal from
 * MENU as well as from GAME_OVER.
 *
 * A local copy on purpose. The table is this game's rules; four games sharing
 * one table would mean none of them owned it.
 *
 * There is no state for "between stages", for "ship exploding", or for "the
 * beam is open". All three are timers inside PLAYING, because each accepts
 * exactly the same input as the moments either side of it. A state you can be
 * in for 1.4 seconds that changes no input handling is a flag, not a state.
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
  [BOOT]: Object.freeze({
    [E.START]: PLAYING,
    [E.TO_MENU]: MENU
  }),
  [MENU]: Object.freeze({
    [E.START]: PLAYING,
    [E.RESTART]: PLAYING
  }),
  [PLAYING]: Object.freeze({
    [E.PAUSE]: PAUSED,
    [E.BLUR]: PAUSED,
    // DIE is both endings. Clearing stage MAX_STAGE is a win but lands in the
    // same terminal state; state.won tells them apart.
    [E.DIE]: GAME_OVER,
    [E.RESTART]: PLAYING,
    [E.TO_MENU]: MENU
  }),
  [PAUSED]: Object.freeze({
    [E.RESUME]: PLAYING,
    [E.PAUSE]: PLAYING,      // the pause key toggles
    [E.RESTART]: PLAYING,
    [E.TO_MENU]: MENU
  }),
  [GAME_OVER]: Object.freeze({
    [E.RESTART]: PLAYING,
    [E.TO_MENU]: MENU
  })
});

/** The state an event leads to, or the current state if the pair is illegal. */
export function transition(state, event) {
  const row = TABLE[state];
  if (!row) throw new Error(`unknown state: ${state}`);
  return row[event] ?? state;
}

/** Whether steering and firing should be applied. */
export function acceptsGameplayInput(state) {
  return state === PLAYING;
}

/** Whether the simulation advances. PAUSED freezes divers mid-arc. */
export function isRunning(state) {
  return state === PLAYING;
}
