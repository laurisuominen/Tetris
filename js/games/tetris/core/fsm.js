/**
 * Game state machine — spec §11.
 *
 * Replaces v1's state integer plus its scattered booleans. Transitions are a
 * frozen table, so an illegal (state, event) pair is a no-op by construction
 * rather than something the caller has to remember to guard.
 *
 * This is the ONLY thing gating input and gravity. There is no second source of
 * truth about whether the game is running.
 */

export const STATES = Object.freeze({
  BOOT: 'BOOT',
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  LINE_CLEAR: 'LINE_CLEAR',
  PAUSED: 'PAUSED',
  GAME_OVER: 'GAME_OVER'
});

export const EVENTS = Object.freeze({
  START: 'START',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  LINES_DETECTED: 'LINES_DETECTED',
  CLEAR_COMPLETE: 'CLEAR_COMPLETE',
  TOP_OUT: 'TOP_OUT',
  RESTART: 'RESTART',
  TO_MENU: 'TO_MENU',
  BLUR: 'BLUR'
});

const { BOOT, MENU, PLAYING, LINE_CLEAR, PAUSED, GAME_OVER } = STATES;
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
    [E.LINES_DETECTED]: LINE_CLEAR,
    [E.TOP_OUT]: GAME_OVER,
    [E.RESTART]: PLAYING,
    [E.TO_MENU]: MENU
  }),
  [LINE_CLEAR]: Object.freeze({
    // CLEAR_COMPLETE can also land on GAME_OVER when the spawn after the clear
    // blocks out; game.js passes TOP_OUT in that case rather than overloading
    // this event with a conditional target.
    [E.CLEAR_COMPLETE]: PLAYING,
    [E.TOP_OUT]: GAME_OVER,
    [E.PAUSE]: PAUSED,
    [E.BLUR]: PAUSED,
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

/** Whether an event actually changes anything from here. */
export function canHandle(state, event) {
  return transition(state, event) !== state || Boolean(TABLE[state]?.[event]);
}

/** Whether gameplay input (move, rotate, drop, hold) should be applied. */
export function acceptsGameplayInput(state) {
  return state === PLAYING;
}

/** Whether game timers advance. Paused freezes gravity and the clear timer. */
export function isRunning(state) {
  return state === PLAYING || state === LINE_CLEAR;
}
