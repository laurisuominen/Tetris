/**
 * Game state machine.
 *
 * Same construction as Tetris's fsm.js — a frozen transition table, so an
 * illegal (state, event) pair is a no-op by construction rather than something
 * every caller has to remember to guard. Snake's table is the smaller one:
 * there is no LINE_CLEAR equivalent, because nothing here pauses the world to
 * play an animation.
 *
 * Deliberately a local copy rather than a promoted shared module. The table is
 * the game's rules; two games sharing one table would mean neither owns it.
 *
 * This is the ONLY thing gating input and movement. There is no second source
 * of truth about whether the game is running.
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
    [E.START]: PLAYING
  }),
  [PLAYING]: Object.freeze({
    [E.PAUSE]: PAUSED,
    [E.BLUR]: PAUSED,
    // DIE covers both endings. Filling the board is a win, not a death, but it
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

/** Whether gameplay input (a turn) should be applied. */
export function acceptsGameplayInput(state) {
  return state === PLAYING;
}

/** Whether the move timer advances. Paused freezes the snake mid-cell. */
export function isRunning(state) {
  return state === PLAYING;
}
