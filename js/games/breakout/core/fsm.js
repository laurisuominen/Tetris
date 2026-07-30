/**
 * Game state machine.
 *
 * A verbatim-shaped copy of Snake's table, down to the MENU/RESTART row that
 * Snake shipped without and which made its Play button do nothing. Every entry
 * point into a run funnels through one startNewGame() that dispatches RESTART,
 * so RESTART must be legal from MENU as well as from GAME_OVER.
 *
 * Deliberately a local copy rather than a promoted shared module: the table is
 * the game's rules, and three games sharing one table would mean none owns it.
 *
 * Breakout has no sixth state for serving or for the pause between screens.
 * Both are booleans and timers inside PLAYING — see core/game.js. A state you
 * can be in for 400ms and which accepts exactly the same input as the state
 * either side of it is not a state, it is a flag.
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
    // DIE covers both endings. Clearing level 99 is a win, not a death, but it
    // lands in the same terminal state; state.won is what tells them apart.
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

/** Whether gameplay input (paddle movement, launch) should be applied. */
export function acceptsGameplayInput(state) {
  return state === PLAYING;
}

/** Whether the simulation advances. Paused freezes the ball mid-flight. */
export function isRunning(state) {
  return state === PLAYING;
}
