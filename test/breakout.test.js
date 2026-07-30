/**
 * Breakout core tests.
 *
 * The collision solver is the reason this file is long. Everything else in the
 * game is bookkeeping; the swept intersection is the part where a subtle error
 * shows up as a ball escaping the playfield twenty minutes into someone's run,
 * so it gets both unit tests on the primitive and property tests on the whole
 * simulation.
 */

import { describe, it, expect } from './harness.js';

import {
  sweep, ejectFromBox, createHit, AXIS_X, AXIS_Y, AXIS_BOTH
} from '../js/games/breakout/core/collision.js';
import {
  COLS, ROWS, BALL_RADIUS, BRICK_COLS, BRICK_ROWS, BRICK_TOP, BRICK_W, BRICK_H,
  PADDLE_Y, PADDLE_W, PADDLE_W_SMALL, MAX_BALL_SPEED, SPEEDS, SPEED_TABLE,
  SCORE_MULTIPLIER_CAP, ROW_POINTS, brickIndex
} from '../js/games/breakout/core/constants.js';
import { createGame, step, applyAction, configure, ACTIONS } from '../js/games/breakout/core/game.js';
import { STATES } from '../js/games/breakout/core/fsm.js';
import { createPaddle, deflect, movePaddle } from '../js/games/breakout/core/paddle.js';
import { createBall, launch, setSpeed } from '../js/games/breakout/core/ball.js';
import {
  createBricks, resetBricks, damage, brickLeft, brickTop,
  brickRight, brickBottom, lowestLiveRow
} from '../js/games/breakout/core/bricks.js';
import { brickPoints, scoreMultiplier, levelStartSpeed, speedUp } from '../js/games/breakout/core/scoring.js';

const TICK = 1000 / 60;
const idle = { actions: [], axis: 0, pointer: null };

/** A run in PLAYING with the ball launched straight up. */
function playing(options = {}) {
  const state = createGame(options);
  applyAction(state, ACTIONS.RESTART);
  return state;
}

function tick(state, times = 1, input = idle) {
  const events = [];
  for (let i = 0; i < times; i++) events.push(...step(state, TICK, input).events);
  return events;
}

/* -------------------------------------------------------------------------- */

describe('breakout collision: the swept primitive', () => {
  const out = createHit();
  // A unit box from (10,10) to (11,11).
  const box = [10, 10, 11, 11];

  it('hits the left face travelling right', () => {
    expect(sweep(out, 8, 10.5, 4, 0, ...box)).toBe(true);
    expect(out.t).toBeCloseTo(0.5);
    expect(out.axis).toBe(AXIS_X);
  });

  it('hits the right face travelling left', () => {
    expect(sweep(out, 13, 10.5, -4, 0, ...box)).toBe(true);
    expect(out.t).toBeCloseTo(0.5);
    expect(out.axis).toBe(AXIS_X);
  });

  it('hits the top face travelling down', () => {
    expect(sweep(out, 10.5, 8, 0, 4, ...box)).toBe(true);
    expect(out.t).toBeCloseTo(0.5);
    expect(out.axis).toBe(AXIS_Y);
  });

  it('hits the bottom face travelling up', () => {
    expect(sweep(out, 10.5, 13, 0, -4, ...box)).toBe(true);
    expect(out.t).toBeCloseTo(0.5);
    expect(out.axis).toBe(AXIS_Y);
  });

  it('reports a corner as both axes, so both components flip', () => {
    // Straight at (10,10) on the diagonal.
    expect(sweep(out, 8, 8, 4, 4, ...box)).toBe(true);
    expect(out.t).toBeCloseTo(0.5);
    expect(out.axis).toBe(AXIS_BOTH);
  });

  it('misses a box the path passes beside', () => {
    expect(sweep(out, 8, 20, 4, 0, ...box)).toBe(false);
  });

  it('misses a box further away than this step travels', () => {
    expect(sweep(out, 0, 10.5, 1, 0, ...box)).toBe(false);
  });

  it('misses a box that is behind the ray', () => {
    expect(sweep(out, 13, 10.5, 4, 0, ...box)).toBe(false);
  });

  it('reports no hit when the ray starts inside — the caller must eject', () => {
    // Reflecting off a surface you are already inside drives you deeper. This
    // has to be a non-hit so the overlap path handles it instead.
    expect(sweep(out, 10.5, 10.5, 1, 0, ...box)).toBe(false);
  });

  it('handles a zero component without dividing by zero', () => {
    // Parallel to the x slabs and outside them: never enters.
    expect(sweep(out, 20, 8, 0, 4, ...box)).toBe(false);
    // Parallel and between them: enters through y.
    expect(sweep(out, 10.5, 8, 0, 4, ...box)).toBe(true);
    expect(Number.isNaN(out.t)).toBe(false);
  });

  it('ejects a point that is inside, through its nearest face', () => {
    const spot = { x: 0, y: 0 };
    // Nearer the left edge than any other.
    expect(ejectFromBox(spot, 10.1, 10.5, ...box)).toBe(AXIS_X);
    expect(spot.x).toBeCloseTo(10);
    // Nearer the top.
    expect(ejectFromBox(spot, 10.5, 10.1, ...box)).toBe(AXIS_Y);
    expect(spot.y).toBeCloseTo(10);
    // Outside: nothing to do.
    expect(ejectFromBox(spot, 5, 5, ...box)).toBe(0);
  });
});

describe('breakout paddle: the angle invariant', () => {
  it('sends the ball left when struck left of centre, and vice versa', () => {
    const paddle = createPaddle();
    const ball = createBall();

    ball.x = paddle.x - paddle.width / 2;
    deflect(ball, paddle, 20);
    expect(ball.vx).toBeLessThan(0);

    ball.x = paddle.x + paddle.width / 2;
    deflect(ball, paddle, 20);
    expect(ball.vx).toBeGreaterThan(0);
  });

  it('always sends the ball upward, even at the extreme edges', () => {
    const paddle = createPaddle();
    const ball = createBall();
    for (let offset = -1.5; offset <= 1.5; offset += 0.05) {
      ball.x = paddle.x + offset * (paddle.width / 2);
      deflect(ball, paddle, 20);
      expect(ball.vy).toBeLessThan(0);
    }
  });

  it('never produces a trajectory shallower than 30 degrees off horizontal', () => {
    const paddle = createPaddle();
    const ball = createBall();
    const minRatio = Math.tan((30 * Math.PI) / 180);   // |vy| / |vx| at 30 deg

    // Includes offsets beyond +/-1, which the clamp has to absorb.
    for (let offset = -2; offset <= 2; offset += 0.01) {
      ball.x = paddle.x + offset * (paddle.width / 2);
      deflect(ball, paddle, 20);
      if (ball.vx === 0) continue;
      const ratio = Math.abs(ball.vy) / Math.abs(ball.vx);
      // A hair of tolerance for the exact +/-1 endpoints.
      expect(ratio).toBeGreaterThan(minRatio - 1e-9);
    }
  });

  it('preserves the requested speed exactly', () => {
    const paddle = createPaddle();
    const ball = createBall();
    ball.x = paddle.x + 0.7 * (paddle.width / 2);
    deflect(ball, paddle, 23.5);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(23.5);
  });

  it('rescales speed without changing direction', () => {
    const ball = createBall();
    launch(ball, 20, 0.6);
    const before = Math.atan2(ball.vy, ball.vx);
    setSpeed(ball, 40);
    expect(Math.atan2(ball.vy, ball.vx)).toBeCloseTo(before);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(40);
  });

  it('stops at the side walls instead of banking momentum against them', () => {
    const paddle = createPaddle();
    // Drive left for a full second; the paddle must end flush, not beyond.
    for (let i = 0; i < 60; i++) movePaddle(paddle, TICK, -1, null);
    expect(paddle.x).toBeCloseTo(paddle.width / 2);
    expect(paddle.vx).toBe(0);
    // And it must leave immediately when reversed, not spend time unwinding.
    movePaddle(paddle, TICK, 1, null);
    expect(paddle.x).toBeGreaterThan(paddle.width / 2);
  });

  it('stops within a fraction of a cell once the key is released', () => {
    // Glide is v^2 / 2a. Too much of it and the paddle reads as ignoring you,
    // which is fatal in a game about putting it in an exact spot. This was
    // measured at 2.2 cells before PADDLE_ACCEL was retuned.
    const paddle = createPaddle();
    for (let i = 0; i < 60; i++) movePaddle(paddle, TICK, 1, null);   // up to speed
    const released = paddle.x;

    for (let i = 0; i < 60; i++) movePaddle(paddle, TICK, 0, null);
    expect(paddle.vx).toBe(0);
    expect(paddle.x - released).toBeLessThan(1);
  });

  it('clamps a pointer target to the playfield', () => {
    const paddle = createPaddle();
    movePaddle(paddle, TICK, 0, -50);
    expect(paddle.x).toBeCloseTo(paddle.width / 2);
    movePaddle(paddle, TICK, 0, 999);
    expect(paddle.x).toBeCloseTo(COLS - paddle.width / 2);
  });
});

describe('breakout bricks and scoring', () => {
  it('fills a screen worth exactly the classic 448 points at level 1', () => {
    let total = 0;
    for (let row = 0; row < BRICK_ROWS; row++) {
      total += ROW_POINTS[row] * BRICK_COLS * scoreMultiplier(1);
    }
    expect(total).toBe(448);
  });

  it('multiplies brick value by the level, capped', () => {
    expect(brickPoints(0, 1)).toBe(7);
    expect(brickPoints(0, 5)).toBe(35);
    expect(brickPoints(0, SCORE_MULTIPLIER_CAP)).toBe(7 * SCORE_MULTIPLIER_CAP);
    expect(brickPoints(0, SCORE_MULTIPLIER_CAP + 40)).toBe(7 * SCORE_MULTIPLIER_CAP);
  });

  it('rejects a row that has no point value', () => {
    expect(() => brickPoints(BRICK_ROWS, 1)).toThrow();
  });

  it('rejects an unknown speed tier rather than defaulting', () => {
    expect(() => levelStartSpeed('TURBO', 1)).toThrow();
  });

  it('never lets a speed-up exceed the cap the solver is sized for', () => {
    let speed = SPEED_TABLE[SPEEDS.FRANTIC].baseSpeed;
    for (let i = 0; i < 100; i++) speed = speedUp(speed);
    expect(speed).toBe(MAX_BALL_SPEED);
    expect(levelStartSpeed(SPEEDS.FRANTIC, 99)).toBe(MAX_BALL_SPEED);
  });

  it('counts a screen down to zero and back up on reset', () => {
    const bricks = createBricks();
    resetBricks(bricks);
    expect(bricks.remaining).toBe(BRICK_COLS * BRICK_ROWS);

    expect(damage(bricks, 0)).toBe(true);
    expect(bricks.remaining).toBe(BRICK_COLS * BRICK_ROWS - 1);
    // A brick already gone cannot be destroyed twice.
    expect(damage(bricks, 0)).toBe(false);
    expect(bricks.remaining).toBe(BRICK_COLS * BRICK_ROWS - 1);

    resetBricks(bricks);
    expect(bricks.remaining).toBe(BRICK_COLS * BRICK_ROWS);
  });

  it('lays bricks out edge to edge with no gaps and no overlap', () => {
    for (let row = 0; row < BRICK_ROWS; row++) {
      for (let col = 0; col < BRICK_COLS - 1; col++) {
        expect(brickRight(brickIndex(row, col)))
          .toBeCloseTo(brickLeft(brickIndex(row, col + 1)));
      }
      expect(brickLeft(brickIndex(row, 0))).toBe(0);
      expect(brickRight(brickIndex(row, BRICK_COLS - 1))).toBe(COLS);
    }
    expect(brickTop(brickIndex(0, 0))).toBe(BRICK_TOP);
    expect(brickBottom(brickIndex(BRICK_ROWS - 1, 0)))
      .toBe(BRICK_TOP + BRICK_ROWS * BRICK_H);
  });

  it('reports the lowest live row, and -1 when the screen is clear', () => {
    const bricks = createBricks();
    resetBricks(bricks);
    expect(lowestLiveRow(bricks)).toBe(BRICK_ROWS - 1);
    for (let col = 0; col < BRICK_COLS; col++) damage(bricks, brickIndex(BRICK_ROWS - 1, col));
    expect(lowestLiveRow(bricks)).toBe(BRICK_ROWS - 2);
    bricks.hp.fill(0);
    expect(lowestLiveRow(bricks)).toBe(-1);
  });
});

describe('breakout lifecycle', () => {
  it('starts in the menu with a full wall and the ball on the paddle', () => {
    const state = createGame();
    expect(state.fsm).toBe(STATES.MENU);
    expect(state.bricks.remaining).toBe(BRICK_COLS * BRICK_ROWS);
    expect(state.ballAttached).toBe(true);
    expect(state.lives).toBe(3);
  });

  it('starts a run on RESTART from the menu — the action the UI actually sends', () => {
    // Snake shipped with this row missing from its table and the Play button
    // did nothing at all. Every entry point here dispatches RESTART.
    const state = createGame();
    applyAction(state, ACTIONS.RESTART);
    expect(state.fsm).toBe(STATES.PLAYING);
  });

  it('does not reset a live game when START arrives', () => {
    const state = playing();
    applyAction(state, ACTIONS.LAUNCH);
    tick(state, 60);
    const score = state.score;
    expect(score).toBeGreaterThan(0);
    applyAction(state, ACTIONS.START);
    expect(state.score).toBe(score);
  });

  it('keeps the ball glued to the paddle until launch', () => {
    const state = playing();
    tick(state, 30, { actions: [], axis: 1, pointer: null });
    expect(state.ballAttached).toBe(true);
    expect(state.ball.x).toBeCloseTo(state.paddle.x);
    expect(state.ball.y).toBeCloseTo(PADDLE_Y - BALL_RADIUS);

    tick(state, 1, { actions: [ACTIONS.LAUNCH], axis: 0, pointer: null });
    expect(state.ballAttached).toBe(false);
    expect(state.ball.vy).toBeLessThan(0);
  });

  it('toggles back out of pause', () => {
    const state = playing();
    applyAction(state, ACTIONS.PAUSE);
    expect(state.fsm).toBe(STATES.PAUSED);
    applyAction(state, ACTIONS.PAUSE);
    expect(state.fsm).toBe(STATES.PLAYING);
  });

  it('freezes the simulation while paused', () => {
    const state = playing();
    applyAction(state, ACTIONS.LAUNCH);
    tick(state, 10);
    applyAction(state, ACTIONS.PAUSE);
    const { x, y } = state.ball;
    tick(state, 60);
    expect(state.ball.x).toBe(x);
    expect(state.ball.y).toBe(y);
  });

  it('applies a speed change only once the next run starts', () => {
    const state = playing();
    applyAction(state, ACTIONS.LAUNCH);
    const before = state.ballSpeed;
    configure(state, { speed: SPEEDS.FRANTIC });
    expect(state.ballSpeed).toBe(before);
    applyAction(state, ACTIONS.RESTART);
    expect(state.ballSpeed).toBe(SPEED_TABLE[SPEEDS.FRANTIC].baseSpeed);
  });

  it('loses a life when the ball goes past the paddle, and ends at zero', () => {
    const state = playing();
    // Aim the ball down the side, away from the paddle parked mid-field.
    state.ballAttached = false;
    state.ball.x = 1;
    state.ball.y = PADDLE_Y - 2;
    state.ball.vx = 0;
    state.ball.vy = state.ballSpeed;

    tick(state, 60);
    expect(state.lives).toBe(2);
    expect(state.ballAttached).toBe(true);

    for (const remaining of [1, 0]) {
      state.ballAttached = false;
      state.ball.x = 1;
      state.ball.y = PADDLE_Y - 2;
      state.ball.vx = 0;
      state.ball.vy = state.ballSpeed;
      tick(state, 60);
      expect(state.lives).toBe(remaining);
    }
    expect(state.fsm).toBe(STATES.GAME_OVER);
    expect(state.won).toBe(false);
  });
});

describe('breakout collision behaviour in the running game', () => {
  it('bounces off the side walls and keeps the ball inside', () => {
    const state = playing();
    state.ballAttached = false;
    state.ball.x = COLS / 2;
    state.ball.y = 20;
    state.ball.vx = state.ballSpeed;
    state.ball.vy = 0;

    tick(state, 120);
    expect(state.ball.x).toBeGreaterThan(BALL_RADIUS - 1e-3);
    expect(state.ball.x).toBeLessThan(COLS - BALL_RADIUS + 1e-3);
  });

  it('leaves |vx| and |vy| untouched through wall and brick bounces', () => {
    const state = playing();
    state.ballAttached = false;
    state.ball.x = 7.3;
    state.ball.y = 20;
    // Pinned at the cap so no classic speed-up can rescale the velocity, and
    // the ball's own speed matches it so a paddle bounce would be the only way
    // the magnitudes could change. The loop stops before one can happen.
    state.ballSpeed = MAX_BALL_SPEED;
    setSpeed(state.ball, MAX_BALL_SPEED);
    state.ball.vx = MAX_BALL_SPEED * 0.6;
    state.ball.vy = -MAX_BALL_SPEED * 0.8;

    let bounces = 0;
    for (let i = 0; i < 400; i++) {
      const events = step(state, TICK, idle).events;
      // The paddle is the one surface that legitimately sets a new direction.
      if (events.some((e) => e.type === 'bounce' && e.surface === 'paddle')) break;
      if (state.ballAttached) break;
      bounces += events.filter((e) => e.type === 'bounce').length;
      expect(Math.abs(state.ball.vx)).toBeCloseTo(MAX_BALL_SPEED * 0.6, 1e-6);
      expect(Math.abs(state.ball.vy)).toBeCloseTo(MAX_BALL_SPEED * 0.8, 1e-6);
    }
    // Worthless if it never actually bounced off anything.
    expect(bounces).toBeGreaterThan(0);
  });

  it('does not tunnel past a lone brick at ten times the maximum speed', () => {
    // Deliberately isolating. A single brick, far from where the ball starts,
    // squarely in its path, crossed entirely within one step. A solver that
    // tests the ball's POSITION rather than its PATH — or that only looks at
    // the lattice cell the ball is currently in — finds nothing here and the
    // ball sails through. This test is the reason the sweep exists.
    const state = playing();
    state.bricks.hp.fill(0);
    const target = brickIndex(2, 3);
    state.bricks.hp[target] = 1;
    state.bricks.remaining = 1;

    state.ballAttached = false;
    state.ball.x = brickLeft(target) + BRICK_W / 2;
    state.ball.vx = 0;
    state.ball.vy = -MAX_BALL_SPEED * 10;         // 8 cells in one 16.7ms step

    // Positioned so a single step crosses the whole brick and comes out the
    // far side. Anything that does not test the path will miss it entirely.
    const travel = (MAX_BALL_SPEED * 10 * TICK) / 1000;
    state.ball.y = brickBottom(target) + travel * 0.75;
    expect(travel).toBeGreaterThan(state.ball.y - brickTop(target));

    tick(state, 1);

    expect(state.bricks.remaining).toBe(0);       // it was hit, not skipped
    expect(state.ball.vy).toBeGreaterThan(0);     // and sent back down
    expect(state.ball.y).toBeGreaterThan(brickTop(target));  // never got past it
  });

  it('halves the paddle the first time the ball reaches the ceiling', () => {
    const state = playing();
    expect(state.paddle.width).toBe(PADDLE_W);

    state.ballAttached = false;
    state.ball.x = 7.3;
    state.ball.y = 2;                    // already above the wall
    state.ball.vx = 0;
    state.ball.vy = -state.ballSpeed;

    tick(state, 20);
    expect(state.brokeThrough).toBe(true);
    expect(state.paddle.width).toBe(PADDLE_W_SMALL);
  });

  it('ejects the ball when the paddle is teleported on top of it', () => {
    const state = playing();
    state.ballAttached = false;
    state.ball.x = 4;
    state.ball.y = PADDLE_Y;             // inside the paddle's box
    state.ball.vx = 0;
    state.ball.vy = state.ballSpeed;     // heading down, about to be swallowed

    // The pointer slams the paddle onto the ball.
    step(state, TICK, { actions: [], axis: 0, pointer: 4 });

    expect(state.ball.vy).toBeLessThan(0);        // sent back up
    expect(state.ball.y).toBeLessThan(PADDLE_Y);  // and out of the paddle
  });

  it('speeds up on the 4th brick, the 12th, and the first orange and red', () => {
    const state = playing();
    const seen = [];

    // A rally with the paddle glued under the ball, so the run continues until
    // the schedule has had a chance to fire all four times. The flight path is
    // not what is under test; the trigger schedule is.
    const serve = () => {
      state.ballAttached = false;
      state.ball.y = PADDLE_Y - 1;
      state.ball.vx = 3;
      state.ball.vy = -state.ballSpeed;
    };
    serve();

    for (let i = 0; i < 6000 && state.hitCount < 14; i++) {
      const events = step(state, TICK, { actions: [], axis: 0, pointer: state.ball.x }).events;
      for (const e of events) if (e.type === 'speedUp') seen.push(state.hitCount);
      if (state.ballAttached) serve();
    }

    // Four triggers: the 4th brick, the 12th, and the first orange (5) and
    // first red (7) bricks, whenever the ball happens to reach those rows.
    expect(state.hitCount).toBe(14);
    expect(seen.filter((h) => h === 4).length).toBe(1);
    expect(seen.filter((h) => h === 12).length).toBe(1);
    expect(seen.length).toBe(4);
    // Each trigger is a real acceleration, so the ball ends faster than it began.
    expect(state.ballSpeed).toBeGreaterThan(SPEED_TABLE[SPEEDS.CLASSIC].baseSpeed);
  });

  it('clears a screen, pauses, then serves the next one faster', () => {
    const state = playing();
    // Empty the wall but for one brick, then break it.
    state.bricks.hp.fill(0);
    const last = brickIndex(BRICK_ROWS - 1, 7);
    state.bricks.hp[last] = 1;
    state.bricks.remaining = 1;

    state.ballAttached = false;
    state.ball.x = brickLeft(last) + BRICK_W / 2;
    state.ball.y = brickBottom(last) + 1;
    state.ball.vx = 0;
    state.ball.vy = -state.ballSpeed;

    const speedBefore = state.ballSpeed;
    tick(state, 20);
    expect(state.bricks.remaining).toBe(0);
    expect(state.levelClearMs).toBeGreaterThan(0);

    tick(state, 90);                       // outlast LEVEL_CLEAR_MS
    expect(state.level).toBe(2);
    expect(state.bricks.remaining).toBe(BRICK_COLS * BRICK_ROWS);
    expect(state.ballSpeed).toBeGreaterThan(speedBefore);
    expect(state.ballAttached).toBe(true);
    expect(state.paddle.width).toBe(PADDLE_W);   // restored with the new screen
  });

  it('scores the second screen at double, per the level multiplier', () => {
    const state = playing();
    expect(brickPoints(BRICK_ROWS - 1, state.level)).toBe(1);
    state.level = 2;
    expect(brickPoints(BRICK_ROWS - 1, state.level)).toBe(2);
  });
});

describe('breakout invariants under long play', () => {
  /**
   * The property that actually protects the game. A collision bug shows up here
   * as a ball outside the playfield or sitting inside a brick — states that no
   * amount of correct-looking single-bounce arithmetic rules out.
   */
  it('never leaves the playfield or ends a step inside a live brick', () => {
    // A cheap deterministic generator; the point is varied input, not entropy.
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (const tier of [SPEEDS.CALM, SPEEDS.CLASSIC, SPEEDS.FRANTIC]) {
      const state = playing({ speed: tier });
      applyAction(state, ACTIONS.LAUNCH);

      for (let i = 0; i < 4000; i++) {
        // Flail the paddle around, including teleporting it with the pointer.
        const input = rand() < 0.3
          ? { actions: [], axis: 0, pointer: rand() * COLS }
          : { actions: [], axis: Math.sign(rand() - 0.5), pointer: null };

        step(state, TICK, input);
        if (state.fsm !== STATES.PLAYING) break;
        if (state.ballAttached) { applyAction(state, ACTIONS.LAUNCH); continue; }

        const { x, y } = state.ball;

        // Inside the playfield. The floor is open by design, so the only bound
        // below is the one the life-loss check uses.
        expect(x).toBeGreaterThan(BALL_RADIUS - 1e-6);
        expect(x).toBeLessThan(COLS - BALL_RADIUS + 1e-6);
        expect(y).toBeGreaterThan(BALL_RADIUS - 1e-6);
        expect(y).toBeLessThan(ROWS + BALL_RADIUS + 1e-6);

        // Not overlapping a brick that still exists.
        const col = Math.floor(x / BRICK_W);
        const row = Math.floor((y - BRICK_TOP) / BRICK_H);
        if (row >= 0 && row < BRICK_ROWS && col >= 0 && col < BRICK_COLS) {
          const index = brickIndex(row, col);
          if (state.bricks.hp[index] > 0) {
            const insideX = x > brickLeft(index) && x < brickRight(index);
            const insideY = y > brickTop(index) && y < brickBottom(index);
            expect(insideX && insideY).toBe(false);
          }
        }
      }
    }
  });

  it('keeps the ball speed at the value the schedule says it should be', () => {
    const state = playing({ speed: SPEEDS.FRANTIC });
    applyAction(state, ACTIONS.LAUNCH);

    for (let i = 0; i < 2000; i++) {
      step(state, TICK, { actions: [], axis: 0, pointer: state.ball.x });
      if (state.fsm !== STATES.PLAYING) break;
      if (state.ballAttached) { applyAction(state, ACTIONS.LAUNCH); continue; }
      expect(Math.hypot(state.ball.vx, state.ball.vy)).toBeCloseTo(state.ballSpeed, 1e-6);
      expect(state.ballSpeed).toBeLessThan(MAX_BALL_SPEED + 1e-9);
    }
  });

  it('never scores more than the derived per-second ceiling', () => {
    // The Edge Function rejects above 7000 points/sec. If the engine can beat
    // that, honest players get refused; this is the test that says it cannot.
    const state = playing({ speed: SPEEDS.FRANTIC });
    state.level = SCORE_MULTIPLIER_CAP;      // worst case for the multiplier
    applyAction(state, ACTIONS.LAUNCH);

    for (let i = 0; i < 6000; i++) {
      step(state, TICK, { actions: [], axis: 0, pointer: state.ball.x });
      if (state.fsm !== STATES.PLAYING) break;
      if (state.ballAttached) applyAction(state, ACTIONS.LAUNCH);
    }
    const seconds = state.playTimeMs / 1000;
    expect(state.score / seconds).toBeLessThan(7000);
  });
});
