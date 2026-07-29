/**
 * The pure game reducer.
 *
 * `step(state, dt, input)` advances one fixed timestep and returns the next
 * state plus a list of EVENT DESCRIPTIONS — `{type:'eat', points}`,
 * `{type:'die', won}`. Core never plays a sound, draws a pixel or touches the
 * DOM; render, audio, UI and storage subscribe to that stream instead.
 *
 * The state is mutated in place and returned, matching Tetris. The typed arrays
 * inside it are allocated once and never replaced, which is the point: a move
 * writes a handful of numbers and allocates nothing.
 */

import {
  COLS, ROWS, cellIndex, START_LENGTH, TURN_QUEUE_MAX,
  SPEEDS, DIRECTIONS, OPPOSITE
} from './constants.js';
import {
  createBody, resetBody, headX, headY, tailX, tailY, hitsBody, advanceHead
} from './snake.js';
import { spawnFood } from './food.js';
import { applePoints, moveIntervalMs } from './scoring.js';
import { STATES, EVENTS, transition, acceptsGameplayInput, isRunning } from './fsm.js';
import { mulberry32 } from '../../../shared/util/rng.js';

export const ACTIONS = Object.freeze({
  UP: 'UP',
  DOWN: 'DOWN',
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  START: 'START',
  RESTART: 'RESTART'
});

/** Actions that name a direction. Their values are also DIRECTIONS keys. */
const TURN_ACTIONS = Object.freeze(
  new Set([ACTIONS.UP, ACTIONS.DOWN, ACTIONS.LEFT, ACTIONS.RIGHT])
);

/**
 * Safety valve on the move loop.
 *
 * The interval floor (35ms at Rabbit) is above one timestep (16.7ms), so a step
 * normally produces zero or one move. This only matters if someone retunes the
 * speed table below the timestep, and it turns "the game runs away" into "the
 * game runs slightly slow".
 */
const MAX_MOVES_PER_STEP = 4;

/* -------------------------------------------------------------------------- */

export function createGame({ seed = 1, speed = SPEEDS.SNAKE, wrap = false } = {}) {
  const state = {
    fsm: STATES.MENU,
    body: createBody(),

    /** Current heading, a DIRECTIONS key. */
    dir: 'RIGHT',
    /** Fixed-capacity turn buffer; turnCount says how much of it is live. */
    turns: new Array(TURN_QUEUE_MAX).fill(''),
    turnCount: 0,

    /** Food cell index, or -1 when the board is full. */
    food: -1,
    apples: 0,
    score: 0,
    won: false,

    speed,
    wrap,

    moveTimerMs: 0,
    moveIntervalMs: 0,
    playTimeMs: 0,

    /* Render interpolation anchors — where the head and tail were before the
       most recent move. tailMoved is false on the move that ate, because the
       tail stays put while the snake grows into the apple. */
    prevHeadX: 0,
    prevHeadY: 0,
    prevTailX: 0,
    prevTailY: 0,
    tailMoved: true,

    seed,
    rand: mulberry32(seed)
  };

  resetRun(state, seed);
  return state;
}

/** Rebuilds a run in place. Reuses every typed array; allocates nothing. */
function resetRun(state, seed) {
  if (seed !== undefined) {
    state.seed = seed;
    state.rand = mulberry32(seed);
  }

  const startX = Math.floor(COLS / 2);
  const startY = Math.floor(ROWS / 2);

  resetBody(state.body, {
    headX: startX,
    headY: startY,
    direction: 'RIGHT',
    length: START_LENGTH
  });

  state.dir = 'RIGHT';
  state.turnCount = 0;
  state.apples = 0;
  state.score = 0;
  state.won = false;
  state.playTimeMs = 0;
  state.moveTimerMs = 0;
  state.moveIntervalMs = moveIntervalMs(state.speed, 0);

  state.prevHeadX = startX;
  state.prevHeadY = startY;
  state.prevTailX = startX - (START_LENGTH - 1);
  state.prevTailY = startY;
  state.tailMoved = true;

  state.food = spawnFood(state.body.occupied, state.rand);
}

/**
 * Applies settings. Speed and wrap take effect on the next start, never
 * mid-run — changing the rules under a player who is 200 points in is not a
 * feature.
 */
export function configure(state, { speed, wrap } = {}) {
  if (speed !== undefined) state.speed = speed;
  if (wrap !== undefined) state.wrap = wrap;
  if (!isRunning(state.fsm)) {
    state.moveIntervalMs = moveIntervalMs(state.speed, state.apples);
  }
}

/* --- turn queue ----------------------------------------------------------- */

/**
 * The direction the snake will be heading once everything already queued has
 * been consumed. Validating against THIS rather than the current heading is
 * what makes a fast corner work: press Up then Left in the same tick and both
 * are kept, because Left is judged against Up, not against the Right the snake
 * is still travelling.
 *
 * Validating against the current heading instead has a worse failure than a
 * dropped input: pressing Up then Left while heading Right queues nothing
 * illegal, but pressing Up then Down does — and a 180 is instant death.
 */
function lastQueuedDirection(state) {
  return state.turnCount > 0 ? state.turns[state.turnCount - 1] : state.dir;
}

function enqueueTurn(state, direction, events) {
  if (state.turnCount >= TURN_QUEUE_MAX) return;

  const from = lastQueuedDirection(state);
  // A turn that changes nothing would still cost a queue slot and delay the
  // next real turn by a whole move.
  if (direction === from) return;
  if (direction === OPPOSITE[from]) return;

  state.turns[state.turnCount] = direction;
  state.turnCount += 1;
  events.push({ type: 'turn', direction });
}

function dequeueTurn(state) {
  const next = state.turns[0];
  for (let i = 1; i < state.turnCount; i++) state.turns[i - 1] = state.turns[i];
  state.turnCount -= 1;
  return next;
}

/* --- movement ------------------------------------------------------------- */

function die(state, events, won) {
  state.won = won;
  state.fsm = transition(state.fsm, EVENTS.DIE);
  events.push({
    type: 'die',
    won,
    score: state.score,
    apples: state.apples,
    length: state.body.length
  });
}

/**
 * One grid move. The ordering of the six clauses below is the correctness core
 * of this game; each of them is covered by a test in test/snake.test.js.
 */
function move(state, events) {
  const body = state.body;

  // 1. One buffered turn per move. Consuming more would let a queued pair
  //    cancel out within a single cell and turn a corner into a no-op.
  if (state.turnCount > 0) state.dir = dequeueTurn(state);

  // 2. Where the head is going.
  const { dx, dy } = DIRECTIONS[state.dir];
  let nx = headX(body) + dx;
  let ny = headY(body) + dy;

  if (state.wrap) {
    nx = ((nx % COLS) + COLS) % COLS;
    ny = ((ny % ROWS) + ROWS) % ROWS;
  } else if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
    die(state, events, false);
    return;
  }

  // 3. Eating decides whether the tail moves, which decides clause 4.
  const target = cellIndex(nx, ny);
  const eating = target === state.food;

  // 4 & 5. Self-collision, with the vacating tail cell exempted. See hitsBody.
  if (hitsBody(body, target, !eating)) {
    die(state, events, false);
    return;
  }

  // 6. Commit. Anchors are captured first, while the old positions still exist.
  state.prevHeadX = headX(body);
  state.prevHeadY = headY(body);
  state.prevTailX = tailX(body);
  state.prevTailY = tailY(body);
  state.tailMoved = !eating;

  advanceHead(body, nx, ny, eating);

  if (eating) {
    const points = applePoints(state.speed);
    state.apples += 1;
    state.score += points;
    state.moveIntervalMs = moveIntervalMs(state.speed, state.apples);

    state.food = spawnFood(body.occupied, state.rand);
    events.push({
      type: 'eat',
      points,
      apples: state.apples,
      length: body.length
    });

    // No free cell left: the snake is the board. That is a win, and it shares
    // the GAME_OVER state with dying — state.won is what tells them apart.
    if (state.food === -1) die(state, events, true);
  }
}

/* --- reducer -------------------------------------------------------------- */

export function applyAction(state, action, events = [], seed = undefined) {
  if (TURN_ACTIONS.has(action)) {
    if (acceptsGameplayInput(state.fsm)) enqueueTurn(state, action, events);
    return { state, events };
  }

  switch (action) {
    case ACTIONS.START: {
      // An illegal transition returns the current state unchanged, so from
      // PLAYING this would read as "already where we want to be" and fall
      // through to resetRun — wiping a live game. RESTART is the action that
      // may do that; START is not.
      if (state.fsm === STATES.PLAYING) break;
      const next = transition(state.fsm, EVENTS.START);
      if (next !== STATES.PLAYING) break;
      resetRun(state, seed);
      state.fsm = next;
      events.push({ type: 'start' });
      break;
    }

    case ACTIONS.RESTART: {
      const next = transition(state.fsm, EVENTS.RESTART);
      if (next !== STATES.PLAYING) break;
      resetRun(state, seed);
      state.fsm = next;
      events.push({ type: 'start' });
      break;
    }

    case ACTIONS.PAUSE: {
      // PAUSE toggles: PLAYING -> PAUSED and PAUSED -> PLAYING.
      const next = transition(state.fsm, EVENTS.PAUSE);
      if (next === state.fsm) break;
      state.fsm = next;
      events.push({ type: 'pause', paused: next === STATES.PAUSED });
      break;
    }

    case ACTIONS.RESUME: {
      const next = transition(state.fsm, EVENTS.RESUME);
      if (next === state.fsm) break;
      state.fsm = next;
      events.push({ type: 'pause', paused: false });
      break;
    }
  }

  return { state, events };
}

export function step(state, dt, input = { actions: [] }) {
  const events = [];

  for (const action of input.actions) {
    applyAction(state, action, events, input.seed);
  }

  if (!isRunning(state.fsm)) return { state, events };

  state.playTimeMs += dt;
  state.moveTimerMs += dt;

  let moves = 0;
  while (state.moveTimerMs >= state.moveIntervalMs && isRunning(state.fsm)) {
    state.moveTimerMs -= state.moveIntervalMs;
    move(state, events);

    if (++moves >= MAX_MOVES_PER_STEP) {
      // Drop the backlog rather than carrying it into the next frame, which is
      // how a slow frame turns into a spiral.
      state.moveTimerMs = 0;
      break;
    }
  }

  return { state, events };
}
