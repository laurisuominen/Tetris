/**
 * The pure game reducer.
 *
 * `step(state, dt, input)` advances exactly one fixed timestep and returns the
 * next state plus a list of EVENT DESCRIPTIONS — `{type:'lock'}`,
 * `{type:'clear', label, points}` and so on. Core never plays a sound, draws a
 * pixel, or touches the DOM; render, audio, UI and storage subscribe to that
 * stream instead. This is the rule that untangles v1's monolith.
 *
 * GameState is plain and serialisable, so a whole game can be snapshotted,
 * diffed in a test, or replayed.
 */

import {
  LOCK_DELAY_MS, MAX_LOCK_RESETS, LINE_CLEAR_MS, SOFT_DROP_FACTOR,
  ROTATE_CW, ROTATE_CCW, ROTATE_HALF, STATE_SPAWN
} from './constants.js';
import { createBoard, collides, lockCells, findFullRows, removeRows } from './board.js';
import {
  createPiece, toBoardCells, translated, isValid, isGrounded, dropDistance
} from './piece.js';
import { tryRotate } from './srs.js';
import { mulberry32 } from './rng.js';
import { createQueue, pull, peek } from './queue.js';
import { dropIntervalMs } from './gravity.js';
import {
  scoreClear, levelFor, softDropPoints, hardDropPoints, TSPIN_NONE
} from './scoring.js';
import { classifyTSpin } from './tspin.js';
import { STATES, EVENTS, transition, acceptsGameplayInput } from './fsm.js';

export const ACTIONS = Object.freeze({
  MOVE_LEFT: 'MOVE_LEFT',
  MOVE_RIGHT: 'MOVE_RIGHT',
  SOFT_DROP: 'SOFT_DROP',
  HARD_DROP: 'HARD_DROP',
  ROTATE_CW: 'ROTATE_CW',
  ROTATE_CCW: 'ROTATE_CCW',
  ROTATE_180: 'ROTATE_180',
  HOLD: 'HOLD',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  START: 'START',
  RESTART: 'RESTART'
});

/* -------------------------------------------------------------------------- */

export function createGame({ seed = 1, startLevel = 1 } = {}) {
  const rand = mulberry32(seed);
  const queue = createQueue(rand);

  return {
    fsm: STATES.MENU,
    board: createBoard(),
    piece: null,
    hold: null,
    canHold: true,
    queue,
    rand,

    score: 0,
    lines: 0,
    level: startLevel,
    startLevel,
    backToBack: false,

    gravityAccum: 0,
    lockTimer: 0,
    lockResets: 0,
    clearTimer: 0,
    pendingRows: [],
    playTimeMs: 0,

    // 'rotate' only when the last successful action was a rotation. ANY
    // translation, gravity included, resets this — the contract tspin.js
    // depends on and the thing v1 got wrong.
    lastAction: 'none',
    lastKickIndex: -1,

    // Bumped whenever the locked stack changes, so the renderer can skip
    // redrawing 200 blocks on frames where nothing moved.
    boardVersion: 0,
    queueVersion: 0,
    holdVersion: 0
  };
}

/* --- internals ------------------------------------------------------------ */

function spawnFrom(state, type, events) {
  const piece = createPiece(type);

  // Block out — spec §3. Emit before the state flips so listeners see the
  // board that caused it.
  if (collides(state.board, toBoardCells(piece))) {
    events.push({ type: 'topOut' });
    state.piece = piece;
    state.fsm = transition(state.fsm, EVENTS.TOP_OUT);
    return false;
  }

  state.piece = piece;
  state.gravityAccum = 0;
  state.lockTimer = 0;
  state.lockResets = 0;
  state.lastAction = 'none';
  state.lastKickIndex = -1;
  events.push({ type: 'spawn', piece });
  return true;
}

function spawnNext(state, events) {
  const { type, queue } = pull(state.queue, state.rand);
  state.queue = queue;
  state.queueVersion++;
  state.canHold = true;
  return spawnFrom(state, type, events);
}

/**
 * Locks the active piece.
 *
 * Score, lines and level are committed here rather than when the clear
 * animation finishes, so pausing mid-animation shows correct numbers and spec
 * §8-§9 hold regardless of when you look.
 *
 * T-spin state is read from named locals captured before anything is cleared —
 * v1 read it off `this.activePiece` from inside the line-clear path, which
 * happened to work only because of call ordering.
 */
function lockPiece(state, events) {
  const piece = state.piece;
  const tSpin = classifyTSpin({
    board: state.board,
    piece,
    lastAction: state.lastAction,
    kickIndex: state.lastKickIndex
  });

  const cells = toBoardCells(piece);
  state.board = lockCells(state.board, cells, piece.type);
  state.boardVersion++;
  state.piece = null;
  events.push({ type: 'lock', cells, pieceType: piece.type });

  const fullRows = findFullRows(state.board);
  const result = scoreClear({
    lines: fullRows.length,
    tSpin,
    level: state.level,
    backToBack: state.backToBack
  });

  state.score += result.points;
  state.backToBack = result.backToBack;

  if (fullRows.length > 0) {
    const previousLevel = state.level;
    state.lines += fullRows.length;
    state.level = Math.max(state.startLevel, levelFor(state.lines));

    state.pendingRows = fullRows;
    state.clearTimer = LINE_CLEAR_MS;
    state.fsm = transition(state.fsm, EVENTS.LINES_DETECTED);

    events.push({
      type: 'clear',
      rows: fullRows,
      lines: fullRows.length,
      label: result.label,
      points: result.points,
      tSpin
    });
    if (state.level > previousLevel) {
      events.push({ type: 'levelUp', level: state.level });
    }
    return;
  }

  if (tSpin !== TSPIN_NONE && result.points > 0) {
    events.push({ type: 'clear', rows: [], lines: 0, label: result.label,
                  points: result.points, tSpin });
  }

  spawnNext(state, events);
}

/** Records a successful move or rotation against the lock-delay budget. */
function registerLockReset(state) {
  if (!state.piece) return;
  if (!isGrounded(state.board, state.piece)) return;
  if (state.lockResets >= MAX_LOCK_RESETS) return;
  state.lockTimer = 0;
  state.lockResets++;
}

function tryMove(state, dx, dy, events) {
  const moved = translated(state.piece, dx, dy);
  if (!isValid(state.board, moved)) return false;
  state.piece = moved;
  state.lastAction = 'move';
  registerLockReset(state);
  events.push({ type: 'move', dx, dy });
  return true;
}

function tryRotation(state, direction, events) {
  const result = tryRotate(state.board, state.piece, direction);
  if (!result) {
    events.push({ type: 'rotateFailed' });
    return false;
  }
  state.piece = result.piece;
  state.lastAction = 'rotate';
  state.lastKickIndex = result.kickIndex;
  registerLockReset(state);
  events.push({ type: 'rotate', kicked: result.kickIndex > 0 });
  return true;
}

function doHold(state, events) {
  if (!state.canHold) return;

  const heldType = state.hold;
  state.hold = state.piece.type;
  state.holdVersion++;
  state.canHold = false;

  if (heldType === null) {
    const { type, queue } = pull(state.queue, state.rand);
    state.queue = queue;
    state.queueVersion++;
    spawnFrom(state, type, events);
  } else {
    spawnFrom(state, heldType, events);
  }
  // spawnFrom resets canHold's siblings but not canHold itself, which must stay
  // false until the next lock — spec §7, one hold per piece.
  state.canHold = false;
  events.push({ type: 'hold' });
}

function doHardDrop(state, events) {
  const distance = dropDistance(state.board, state.piece);
  if (distance > 0) {
    state.piece = translated(state.piece, 0, distance);
    state.score += hardDropPoints(distance);
    // A hard drop is a translation, so it clears any pending rotation and
    // cannot be scored as a T-spin.
    state.lastAction = 'move';
  }
  events.push({ type: 'hardDrop', distance });
  lockPiece(state, events);
}

/* --- public API ----------------------------------------------------------- */

/**
 * Applies a discrete action. Returns the mutated state and its events.
 *
 * `seed` is only read by START/RESTART. It is a parameter rather than a call to
 * Math.random because core must stay pure — that is what lets the determinism
 * test replay an identical game.
 */
export function applyAction(state, action, events = [], seed = 1) {
  switch (action) {
    case ACTIONS.START:
    case ACTIONS.RESTART: {
      const fresh = createGame({ seed, startLevel: state.startLevel });
      Object.assign(state, fresh);
      state.fsm = transition(STATES.MENU, EVENTS.START);
      spawnNext(state, events);
      events.push({ type: 'start' });
      return { state, events };
    }

    case ACTIONS.PAUSE:
      state.fsm = transition(state.fsm, EVENTS.PAUSE);
      events.push({ type: 'pause', paused: state.fsm === STATES.PAUSED });
      return { state, events };

    case ACTIONS.RESUME:
      state.fsm = transition(state.fsm, EVENTS.RESUME);
      events.push({ type: 'pause', paused: false });
      return { state, events };

    default:
      break;
  }

  if (!acceptsGameplayInput(state.fsm) || !state.piece) return { state, events };

  switch (action) {
    case ACTIONS.MOVE_LEFT:  tryMove(state, -1, 0, events); break;
    case ACTIONS.MOVE_RIGHT: tryMove(state, +1, 0, events); break;
    case ACTIONS.ROTATE_CW:  tryRotation(state, ROTATE_CW, events); break;
    case ACTIONS.ROTATE_CCW: tryRotation(state, ROTATE_CCW, events); break;
    case ACTIONS.ROTATE_180: tryRotation(state, ROTATE_HALF, events); break;
    case ACTIONS.HOLD:       doHold(state, events); break;
    case ACTIONS.HARD_DROP:  doHardDrop(state, events); break;
    case ACTIONS.SOFT_DROP:
      if (tryMove(state, 0, 1, events)) {
        state.score += softDropPoints(1);
        state.gravityAccum = 0;
      }
      break;
    default: break;
  }

  return { state, events };
}

/**
 * Advances one fixed timestep.
 *
 * `input` is `{ actions: [], softDrop: bool, seed: number }`. Actions are
 * drained at a step boundary, never mid-resolution, which is what guarantees a
 * keypress cannot land halfway through gravity.
 */
export function step(state, dt, input = { actions: [], softDrop: false }) {
  const events = [];

  // 1. Discrete actions. PAUSE and START are handled even when not playing.
  for (const action of input.actions) {
    applyAction(state, action, events, input.seed ?? 1);
  }

  if (state.fsm === STATES.PLAYING || state.fsm === STATES.LINE_CLEAR) {
    state.playTimeMs += dt;
  }

  if (state.fsm === STATES.LINE_CLEAR) {
    state.clearTimer -= dt;
    if (state.clearTimer <= 0) {
      state.board = removeRows(state.board, state.pendingRows);
      state.boardVersion++;
      state.pendingRows = [];
      state.clearTimer = 0;
      state.fsm = transition(state.fsm, EVENTS.CLEAR_COMPLETE);
      events.push({ type: 'clearComplete' });
      spawnNext(state, events);
    }
    return { state, events };
  }

  if (state.fsm !== STATES.PLAYING || !state.piece) return { state, events };

  // 2. Gravity. The while-loop drains sub-frame intervals at high levels so a
  //    piece can fall several cells in one step — spec §6.
  const interval = dropIntervalMs(state.level) / (input.softDrop ? SOFT_DROP_FACTOR : 1);
  state.gravityAccum += dt;

  let guard = 64;
  while (state.gravityAccum >= interval && guard-- > 0) {
    state.gravityAccum -= interval;
    if (!isValid(state.board, translated(state.piece, 0, 1))) break;

    state.piece = translated(state.piece, 0, 1);
    // Critical: a gravity drop is a translation and must clear any pending
    // rotation, or rotate -> fall -> lock scores as a T-spin. This is exactly
    // the v1 bug.
    state.lastAction = 'move';
    if (input.softDrop) state.score += softDropPoints(1);
    events.push({ type: 'gravity' });
  }

  // 3. Lock delay — spec §6.
  if (isGrounded(state.board, state.piece)) {
    state.lockTimer += dt;
    if (state.lockTimer >= LOCK_DELAY_MS) {
      lockPiece(state, events);
    }
  } else {
    // The piece resumed falling: the timer restarts, but lockResets does NOT.
    // The 15-reset cap is per piece, not per grounding, which is what makes
    // infinite spin impossible.
    state.lockTimer = 0;
  }

  return { state, events };
}

/** The next five upcoming piece types — spec §5. */
export const nextPieces = (state) => peek(state.queue);

/** Ghost position for rendering, or null when there is no active piece. */
export function ghostPosition(state) {
  if (!state.piece) return null;
  return translated(state.piece, 0, dropDistance(state.board, state.piece));
}
