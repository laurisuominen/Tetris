/**
 * The pure game reducer.
 *
 * `step(state, dt, input)` advances one fixed timestep and returns the next
 * state plus a list of EVENT DESCRIPTIONS — `{type:'brick', points}`,
 * `{type:'bounce', surface}`, `{type:'lifeLost'}`. Core never plays a sound,
 * draws a pixel or touches the DOM; render, audio, UI and storage subscribe to
 * that stream instead.
 *
 * State is mutated in place and returned, matching Tetris and Snake. The typed
 * array inside it is allocated once and never replaced, and the collision
 * solver writes into pre-made result records, so a step allocates nothing.
 *
 * `input` is `{ actions, axis, pointer }`:
 *   actions  discrete: LAUNCH, PAUSE, RESUME, START, RESTART
 *   axis     -1 / 0 / +1, from held keys or the on-screen arrows
 *   pointer  absolute paddle target in cell space, or null
 *
 * Left and right are an axis rather than actions because a paddle moves
 * continuously. Queueing "move left" events and draining them at a step
 * boundary is the right shape for a Tetris piece and the wrong one here.
 */

import {
  COLS, ROWS, BALL_RADIUS, BRICK_COLS, BRICK_ROWS, BRICK_W, BRICK_H, BRICK_TOP,
  MAX_COLLISIONS_PER_STEP, PADDLE_W, START_LIVES, MAX_LEVEL, LEVEL_CLEAR_MS,
  SPEEDS, SPEEDUP_AT_HITS, SPEEDUP_ROW_POINTS, brickIndex
} from './constants.js';
import { createBall, attachToPaddle, launch, setSpeed } from './ball.js';
import {
  createPaddle, resetPaddle, shrinkPaddle, movePaddle, deflect,
  paddleLeft, paddleRight, paddleTop, paddleBottom
} from './paddle.js';
import {
  createBricks, resetBricks, damage, pointsOf, rowOf,
  brickLeft, brickTop, brickRight, brickBottom
} from './bricks.js';
import { brickPoints, levelStartSpeed, speedUp } from './scoring.js';
import { sweep, ejectFromBox, createHit, AXIS_X, AXIS_Y } from './collision.js';
import { STATES, EVENTS, transition, acceptsGameplayInput, isRunning } from './fsm.js';

export const ACTIONS = Object.freeze({
  LAUNCH: 'LAUNCH',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  START: 'START',
  RESTART: 'RESTART'
});

/**
 * How far the ball is nudged off a surface after bouncing.
 *
 * Belt and braces, and worth being precise about which. `sweep` already
 * reports a ray that starts inside a box as a non-hit, which covers the exact
 * case: after a bounce the ball sits on the boundary of the box it just left
 * and the entry time comes out at or below zero. SKIN covers the inexact one,
 * where rounding puts that entry time a fraction above zero instead and the
 * solver re-detects the surface it has already resolved.
 *
 * A millionth of a cell — invisible, and larger than the rounding it guards
 * against. No test exercises it: constructing float noise on demand is not
 * something this suite can do honestly, so treat it as a guard rather than as
 * verified behaviour.
 */
const SKIN = 1e-6;

/* -------------------------------------------------------------------------- */

export function createGame({ speed = SPEEDS.CLASSIC } = {}) {
  const state = {
    fsm: STATES.MENU,

    ball: createBall(),
    paddle: createPaddle(),
    bricks: createBricks(),

    /** Chosen tier; the live speed in cells/sec is ballSpeed. */
    speed,
    ballSpeed: 0,

    level: 1,
    lives: START_LIVES,
    score: 0,
    won: false,

    /** The ball rides the paddle until LAUNCH. Not an FSM state — see fsm.js. */
    ballAttached: true,
    /** Ceiling reached this level, so the paddle has already halved. */
    brokeThrough: false,
    /** Bricks destroyed this level; drives the classic 4th/12th speed-ups. */
    hitCount: 0,
    spedUpAtHits: 0,
    hitOrange: false,
    hitRed: false,

    /** Counts down between screens; the ball is frozen while it runs. */
    levelClearMs: 0,

    playTimeMs: 0,

    /* Render interpolation anchors — where things were before this step. */
    prevBallX: 0,
    prevBallY: 0,
    prevPaddleX: COLS / 2,
    /** Set when the ball bounced this step; the renderer then skips ahead-lerp. */
    collidedThisStep: false,

    /* Scratch, allocated once. The solver is called every step and must not
       produce garbage. */
    _hit: createHit(),
    _best: createHit(),
    _eject: { x: 0, y: 0 }
  };

  resetRun(state);
  return state;
}

/** Rebuilds a run in place. Reuses the brick array; allocates nothing. */
function resetRun(state) {
  state.level = 1;
  state.lives = START_LIVES;
  state.score = 0;
  state.won = false;
  state.playTimeMs = 0;
  state.levelClearMs = 0;
  resetPaddle(state.paddle);
  startLevel(state);
}

/** Fresh wall, fresh paddle width, ball back on the paddle. */
function startLevel(state) {
  resetBricks(state.bricks);
  state.brokeThrough = false;
  state.hitCount = 0;
  state.spedUpAtHits = 0;
  state.hitOrange = false;
  state.hitRed = false;
  state.paddle.width = PADDLE_W;
  state.ballSpeed = levelStartSpeed(state.speed, state.level);
  serve(state);
}

/** Parks the ball on the paddle and waits for a launch. */
function serve(state) {
  state.ballAttached = true;
  attachToPaddle(state.ball, state.paddle);
  state.prevBallX = state.ball.x;
  state.prevBallY = state.ball.y;
}

/**
 * Applies settings. The speed tier takes effect on the next start, never
 * mid-run — changing the rules under a player who is 300 points in is not a
 * feature.
 */
export function configure(state, { speed } = {}) {
  if (speed !== undefined) state.speed = speed;
  if (!isRunning(state.fsm)) {
    state.ballSpeed = levelStartSpeed(state.speed, state.level);
  }
}

/* --- endings --------------------------------------------------------------- */

function finish(state, events, won) {
  state.won = won;
  state.fsm = transition(state.fsm, EVENTS.DIE);
  events.push({
    type: 'gameOver',
    won,
    score: state.score,
    level: state.level
  });
}

function loseLife(state, events) {
  state.lives -= 1;
  events.push({ type: 'lifeLost', lives: state.lives });

  if (state.lives <= 0) {
    finish(state, events, false);
    return;
  }
  serve(state);
}

/* --- speed schedule -------------------------------------------------------- */

/**
 * The 1976 rule, in one place: faster after the 4th brick, after the 12th, and
 * on first contact with the orange and then the red rows. Each trigger fires
 * once per screen.
 */
function applySpeedUps(state, points, events) {
  let triggers = 0;

  while (
    state.spedUpAtHits < SPEEDUP_AT_HITS.length &&
    state.hitCount >= SPEEDUP_AT_HITS[state.spedUpAtHits]
  ) {
    state.spedUpAtHits += 1;
    triggers += 1;
  }

  const [redPoints, orangePoints] = SPEEDUP_ROW_POINTS;
  if (points === orangePoints && !state.hitOrange) { state.hitOrange = true; triggers += 1; }
  if (points === redPoints && !state.hitRed) { state.hitRed = true; triggers += 1; }

  if (triggers === 0) return;

  // One step per trigger. Landing on the 4th brick AND the first red at once is
  // rare but possible, and it should be worth two steps, not one.
  for (let i = 0; i < triggers; i++) state.ballSpeed = speedUp(state.ballSpeed);

  setSpeed(state.ball, state.ballSpeed);
  events.push({ type: 'speedUp', speed: state.ballSpeed });
}

/* --- collision ------------------------------------------------------------- */

/* What `nearest` found. Non-negative values are brick indices. */
const NOTHING = -1;
const PADDLE = -2;
const WALL = -3;

/**
 * Nearest obstacle along the ball's remaining path this step.
 *
 * Writes the winner into `state._best` and returns NOTHING, PADDLE, WALL, or a
 * brick index. Walls go through the same swept box as everything else —
 * modelled as slabs just outside the playfield — so there is exactly one
 * collision code path to get right.
 */
function nearest(state, dx, dy) {
  const { ball, bricks, paddle, _hit: hit, _best: best } = state;
  best.hit = false;
  best.t = Infinity;
  let what = NOTHING;

  // Written out rather than wrapped in a closure: `nearest` runs several times
  // a step and a fresh arrow function each call is exactly the per-frame
  // garbage CLAUDE.md rules out.
  const R = BALL_RADIUS;
  const FAR = 1000;

  // Walls, as boxes just outside the playfield. Expanded by the radius like
  // every other obstacle, so a wall is not a special case in the solver.
  if (sweep(hit, ball.x, ball.y, dx, dy, -FAR, -FAR, R, FAR) && hit.t < best.t) {
    best.hit = true; best.t = hit.t; best.axis = hit.axis; what = WALL;
  }
  if (sweep(hit, ball.x, ball.y, dx, dy, COLS - R, -FAR, FAR, FAR) && hit.t < best.t) {
    best.hit = true; best.t = hit.t; best.axis = hit.axis; what = WALL;
  }
  if (sweep(hit, ball.x, ball.y, dx, dy, -FAR, -FAR, FAR, R) && hit.t < best.t) {
    best.hit = true; best.t = hit.t; best.axis = hit.axis; what = WALL;
  }

  if (sweep(
    hit, ball.x, ball.y, dx, dy,
    paddleLeft(paddle) - R, paddleTop() - R,
    paddleRight(paddle) + R, paddleBottom() + R
  ) && hit.t < best.t) {
    best.hit = true; best.t = hit.t; best.axis = hit.axis; what = PADDLE;
  }

  // Bricks, narrowed to the lattice cells the swept path can reach. 112 bricks
  // would scan fine — the cited measurement is 754 candidates in under a
  // millisecond — but the bounds are six lines of integer maths and they keep
  // the common case at a handful of tests.
  const minY = Math.min(ball.y, ball.y + dy) - R;
  const maxY = Math.max(ball.y, ball.y + dy) + R;
  const fieldTop = BRICK_TOP;
  const fieldBottom = BRICK_TOP + BRICK_ROWS * BRICK_H;

  if (bricks.remaining > 0 && maxY >= fieldTop && minY <= fieldBottom) {
    const minX = Math.min(ball.x, ball.x + dx) - R;
    const maxX = Math.max(ball.x, ball.x + dx) + R;

    const colFrom = clampInt(Math.floor(minX / BRICK_W), 0, BRICK_COLS - 1);
    const colTo = clampInt(Math.floor(maxX / BRICK_W), 0, BRICK_COLS - 1);
    const rowFrom = clampInt(Math.floor((minY - BRICK_TOP) / BRICK_H), 0, BRICK_ROWS - 1);
    const rowTo = clampInt(Math.floor((maxY - BRICK_TOP) / BRICK_H), 0, BRICK_ROWS - 1);

    for (let row = rowFrom; row <= rowTo; row++) {
      for (let col = colFrom; col <= colTo; col++) {
        const index = brickIndex(row, col);
        if (bricks.hp[index] === 0) continue;
        if (sweep(
          hit, ball.x, ball.y, dx, dy,
          brickLeft(index) - R, brickTop(index) - R,
          brickRight(index) + R, brickBottom(index) + R
        ) && hit.t < best.t) {
          best.hit = true; best.t = hit.t; best.axis = hit.axis; what = index;
        }
      }
    }
  }

  return what;
}

const clampInt = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Advances the ball for one step, resolving every surface it meets on the way.
 *
 * Swept, not positional: the ball's PATH is tested, so it cannot hop over a
 * brick between frames however fast it is going. After each contact the ball is
 * placed exactly at the intersection, nudged clear by SKIN, reflected, and the
 * remaining time is re-run — the recursion from the reference implementation,
 * written as a bounded loop so a pathological case degrades into a dropped
 * bounce rather than a locked tab.
 */
function moveBall(state, dt, events) {
  const { ball, paddle } = state;
  let remaining = dt / 1000;

  // The paddle is teleported by the pointer rather than swept, so it can appear
  // on top of the ball with no path to intersect. Eject before sweeping: a ball
  // inside the paddle starts every sweep inside a box, which reports no hit,
  // and the paddle would silently swallow it.
  const axis = ejectFromBox(
    state._eject, ball.x, ball.y,
    paddleLeft(paddle) - BALL_RADIUS, paddleTop() - BALL_RADIUS,
    paddleRight(paddle) + BALL_RADIUS, paddleBottom() + BALL_RADIUS
  );
  if (axis !== 0) {
    ball.x = state._eject.x;
    ball.y = state._eject.y;
    if (axis === AXIS_Y && ball.y <= paddleTop()) deflect(ball, paddle, state.ballSpeed);
    else if (axis === AXIS_X) ball.vx = -ball.vx;
    else ball.vy = Math.abs(ball.vy);
    state.collidedThisStep = true;
  }

  for (let iteration = 0; iteration < MAX_COLLISIONS_PER_STEP; iteration++) {
    if (remaining <= 0) return;

    const dx = ball.vx * remaining;
    const dy = ball.vy * remaining;
    const what = nearest(state, dx, dy);

    if (what === -1) {
      ball.x += dx;
      ball.y += dy;
      return;
    }

    const best = state._best;
    ball.x += dx * best.t;
    ball.y += dy * best.t;
    remaining *= 1 - best.t;
    state.collidedThisStep = true;

    // Nudge clear of the surface before reflecting, or the next iteration
    // re-detects it at t = 0.
    if (best.axis & AXIS_X) ball.x -= Math.sign(dx) * SKIN;
    if (best.axis & AXIS_Y) ball.y -= Math.sign(dy) * SKIN;

    if (what === -2) {
      resolvePaddle(state, best.axis, events);
    } else if (what === -3) {
      resolveWall(state, best.axis, events);
    } else {
      resolveBrick(state, what, best.axis, events);
    }
  }
}

function resolvePaddle(state, axis, events) {
  const { ball, paddle } = state;

  // A hit on the top face is the one that steers; the sides and the underside
  // are ordinary reflections. Comparing against the paddle's top edge is what
  // distinguishes them — the ball is sitting one radius above it at contact.
  const onTop = (axis & AXIS_Y) !== 0 && ball.y <= paddleTop();

  if (onTop) {
    deflect(ball, paddle, state.ballSpeed);
  } else {
    if (axis & AXIS_X) ball.vx = -ball.vx;
    if (axis & AXIS_Y) ball.vy = -ball.vy;
  }
  events.push({ type: 'bounce', surface: 'paddle' });
}

function resolveWall(state, axis, events) {
  const { ball } = state;
  if (axis & AXIS_X) ball.vx = -ball.vx;
  if (axis & AXIS_Y) ball.vy = -ball.vy;

  // Reaching the ceiling means the ball got past the wall, which is the classic
  // trigger for halving the paddle. Deliberate deviation: the original keeps it
  // halved for the rest of the game, we restore it with each new screen.
  const hitCeiling = (axis & AXIS_Y) !== 0 && ball.y <= BALL_RADIUS + SKIN * 2;
  if (hitCeiling && !state.brokeThrough) {
    state.brokeThrough = true;
    shrinkPaddle(state.paddle);
    events.push({ type: 'brokeThrough' });
  }

  events.push({ type: 'bounce', surface: hitCeiling ? 'ceiling' : 'wall' });
}

function resolveBrick(state, index, axis, events) {
  const { ball } = state;
  if (axis & AXIS_X) ball.vx = -ball.vx;
  if (axis & AXIS_Y) ball.vy = -ball.vy;

  if (!damage(state.bricks, index)) {
    events.push({ type: 'bounce', surface: 'brick' });
    return;
  }

  const row = rowOf(index);
  const points = brickPoints(row, state.level);
  state.score += points;
  state.hitCount += 1;

  events.push({ type: 'brick', index, row, points, score: state.score });
  applySpeedUps(state, pointsOf(index), events);
}

/* --- reducer --------------------------------------------------------------- */

export function applyAction(state, action, events = []) {
  switch (action) {
    case ACTIONS.LAUNCH: {
      if (!acceptsGameplayInput(state.fsm)) break;
      if (!state.ballAttached || state.levelClearMs > 0) break;
      state.ballAttached = false;
      // Aim the serve by where the paddle sits: hugging a wall serves towards
      // the middle, which is both useful and what the paddle's own deflection
      // rule would do.
      const offset = (state.paddle.x - COLS / 2) / (COLS / 2);
      launch(state.ball, state.ballSpeed, -offset);
      events.push({ type: 'launch' });
      break;
    }

    case ACTIONS.START: {
      // An illegal transition returns the current state unchanged, so from
      // PLAYING this would read as "already where we want to be" and fall
      // through to resetRun — wiping a live game. RESTART may do that; START
      // may not. This is the bug Snake shipped and it is not shipping twice.
      if (state.fsm === STATES.PLAYING) break;
      const next = transition(state.fsm, EVENTS.START);
      if (next !== STATES.PLAYING) break;
      resetRun(state);
      state.fsm = next;
      events.push({ type: 'start' });
      break;
    }

    case ACTIONS.RESTART: {
      const next = transition(state.fsm, EVENTS.RESTART);
      if (next !== STATES.PLAYING) break;
      resetRun(state);
      state.fsm = next;
      events.push({ type: 'start' });
      break;
    }

    case ACTIONS.PAUSE: {
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

export function step(state, dt, input = { actions: [], axis: 0, pointer: null }) {
  const events = [];

  for (const action of input.actions ?? []) applyAction(state, action, events);

  if (!isRunning(state.fsm)) return { state, events };

  state.playTimeMs += dt;
  state.collidedThisStep = false;
  state.prevBallX = state.ball.x;
  state.prevBallY = state.ball.y;
  state.prevPaddleX = state.paddle.x;

  // Between screens the wall is gone and the ball is frozen. Moving the paddle
  // is still allowed, so the player can line up the next serve.
  if (state.levelClearMs > 0) {
    movePaddle(state.paddle, dt, input.axis ?? 0, input.pointer ?? null);
    state.levelClearMs -= dt;
    if (state.levelClearMs <= 0) {
      state.levelClearMs = 0;
      state.level += 1;
      startLevel(state);
      events.push({ type: 'levelStart', level: state.level });
    }
    return { state, events };
  }

  movePaddle(state.paddle, dt, input.axis ?? 0, input.pointer ?? null);

  if (state.ballAttached) {
    attachToPaddle(state.ball, state.paddle);
    return { state, events };
  }

  moveBall(state, dt, events);

  // Past the paddle and off the bottom. The floor is below the paddle, not at
  // it, so squeezing by the paddle's edge is survivable for a moment.
  if (state.ball.y - BALL_RADIUS > ROWS) {
    loseLife(state, events);
    return { state, events };
  }

  if (state.bricks.remaining === 0) {
    if (state.level >= MAX_LEVEL) {
      finish(state, events, true);
      return { state, events };
    }
    state.levelClearMs = LEVEL_CLEAR_MS;
    events.push({ type: 'levelClear', level: state.level });
  }

  return { state, events };
}
