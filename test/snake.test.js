/**
 * Snake core.
 *
 * Everything here is DOM-free, so it runs under Node as well as in the browser.
 * The cases are chosen around the four things that are genuinely easy to get
 * wrong in Snake and invisible when you do:
 *
 *   1. turns validated against the wrong direction  -> the reverse key kills you
 *   2. the tail-vacancy rule                        -> you die chasing your tail
 *   3. food spawn by rejection sampling             -> the game hangs late
 *   4. START treated as idempotent                  -> a live game silently resets
 */

import { describe, it, expect } from './harness.js';
import { createGame, applyAction, step, configure, ACTIONS } from '../js/games/snake/core/game.js';
import { STATES } from '../js/games/snake/core/fsm.js';
import { spawnFood } from '../js/games/snake/core/food.js';
import { applePoints, moveIntervalMs } from '../js/games/snake/core/scoring.js';
import {
  COLS, ROWS, CELL_COUNT, cellIndex, SPEEDS, SPEED_TABLE,
  TURN_QUEUE_MAX, INTERVAL_FLOOR_RATIO
} from '../js/games/snake/core/constants.js';
import { headX, headY, tailX, tailY } from '../js/games/snake/core/snake.js';

/**
 * A started game with no food on the board.
 *
 * food = -1 is not a real game state, it is the test harness: cell indices are
 * never negative, so nothing can ever be eaten and the snake's length stays put
 * while a test drives it into a specific shape.
 */
function startedGame(options = {}) {
  const state = createGame({ seed: 7, ...options });
  applyAction(state, ACTIONS.START, [], 7);
  state.food = -1;
  return state;
}

/** Advances exactly one grid move, whatever the tier's interval happens to be. */
function moveOnce(state, actions = []) {
  const events = [];
  for (const action of actions) applyAction(state, action, events);
  const stepped = step(state, state.moveIntervalMs, { actions: [] });
  return events.concat(stepped.events);
}

const hasType = (events, type) => events.some((e) => e.type === type);

describe('snake turn queue', () => {
  it('refuses a 180 into its own neck', () => {
    const state = startedGame();          // heading RIGHT
    applyAction(state, ACTIONS.LEFT, []);
    expect(state.turnCount).toBe(0);
  });

  /**
   * The case that separates a correct queue from a naive one. Heading RIGHT
   * with UP already queued, DOWN is a 180 relative to what the snake will
   * shortly be doing — even though it is a legal turn relative to RIGHT.
   * Validating against the current heading lets this through, and the snake
   * reverses into itself one move later.
   */
  it('validates against the last queued turn, not the current heading', () => {
    const state = startedGame();
    applyAction(state, ACTIONS.UP, []);
    applyAction(state, ACTIONS.DOWN, []);
    expect(state.turnCount).toBe(1);
    expect(state.turns[0]).toBe('UP');
  });

  /** The fast corner: two turns pressed inside one move must both survive. */
  it('buffers a corner pressed faster than one move', () => {
    const state = startedGame();
    applyAction(state, ACTIONS.UP, []);
    applyAction(state, ACTIONS.LEFT, []);
    expect(state.turnCount).toBe(2);
  });

  it('drops turns beyond its capacity rather than growing', () => {
    const state = startedGame();
    applyAction(state, ACTIONS.UP, []);
    applyAction(state, ACTIONS.LEFT, []);
    applyAction(state, ACTIONS.DOWN, []);
    expect(state.turnCount).toBe(TURN_QUEUE_MAX);
    expect(state.turns.length).toBe(TURN_QUEUE_MAX);
  });

  it('ignores a turn that repeats the current heading', () => {
    const state = startedGame();
    applyAction(state, ACTIONS.RIGHT, []);
    expect(state.turnCount).toBe(0);
  });

  it('consumes exactly one buffered turn per move', () => {
    const state = startedGame();
    applyAction(state, ACTIONS.UP, []);
    applyAction(state, ACTIONS.LEFT, []);

    moveOnce(state);
    expect(state.dir).toBe('UP');
    expect(state.turnCount).toBe(1);

    moveOnce(state);
    expect(state.dir).toBe('LEFT');
    expect(state.turnCount).toBe(0);
  });

  it('ignores turns while paused', () => {
    const state = startedGame();
    applyAction(state, ACTIONS.PAUSE, []);
    applyAction(state, ACTIONS.UP, []);
    expect(state.turnCount).toBe(0);
  });
});

describe('snake tail vacancy', () => {
  /**
   * Curls a length-4 snake into a 2x2 block with its head one step from its own
   * tail, and returns it mid-flight. Built by driving the real reducer rather
   * than hand-assembling a body, so the shape is one the game can actually
   * reach.
   *
   * Final layout, head first: (10,11) (11,11) (11,10) (10,10)
   * The head faces LEFT; turning UP steps onto (10,10), the tail.
   */
  function curled() {
    const state = startedGame();
    state.food = cellIndex(11, 10);       // one step ahead, to reach length 4
    moveOnce(state);
    expect(state.body.length).toBe(4);
    state.food = -1;

    moveOnce(state, [ACTIONS.DOWN]);
    moveOnce(state, [ACTIONS.LEFT]);

    expect(headX(state.body)).toBe(10);
    expect(headY(state.body)).toBe(11);
    expect(tailX(state.body)).toBe(10);
    expect(tailY(state.body)).toBe(10);
    return state;
  }

  it('lets the snake move into the cell its tail is leaving', () => {
    const state = curled();
    const events = moveOnce(state, [ACTIONS.UP]);

    expect(hasType(events, 'die')).toBeFalsy();
    expect(state.fsm).toBe(STATES.PLAYING);
    expect(headX(state.body)).toBe(10);
    expect(headY(state.body)).toBe(10);
  });

  /**
   * The same move while growing is fatal, because the tail stays put.
   *
   * This documents the invariant rather than a reachable position: spawnFood
   * only ever picks a free cell, so food never sits under the snake's own tail
   * in real play. The branch still has to be right — it is the branch that
   * decides the case above.
   */
  it('kills the snake entering that cell on the move it eats', () => {
    const state = curled();
    state.food = cellIndex(10, 10);       // under the tail; see comment above
    const events = moveOnce(state, [ACTIONS.UP]);

    expect(hasType(events, 'die')).toBeTruthy();
    expect(state.fsm).toBe(STATES.GAME_OVER);
    expect(state.won).toBeFalsy();
  });

  it('records that the tail held still on the move it ate', () => {
    const state = startedGame();
    state.food = cellIndex(11, 10);
    moveOnce(state);
    expect(state.tailMoved).toBeFalsy();

    state.food = -1;
    moveOnce(state);
    expect(state.tailMoved).toBeTruthy();
  });
});

describe('snake walls and wrap', () => {
  /** Drives right until the head is against the far wall. */
  function toRightWall(state) {
    while (headX(state.body) < COLS - 1) moveOnce(state);
    return state;
  }

  it('dies at the wall when wrap is off', () => {
    const state = toRightWall(startedGame({ wrap: false }));
    const events = moveOnce(state);

    expect(hasType(events, 'die')).toBeTruthy();
    expect(state.fsm).toBe(STATES.GAME_OVER);
    // The head stops at the last legal cell rather than stepping off the grid.
    expect(headX(state.body)).toBe(COLS - 1);
  });

  it('comes out the other side when wrap is on', () => {
    const state = toRightWall(startedGame({ wrap: true }));
    const events = moveOnce(state);

    expect(hasType(events, 'die')).toBeFalsy();
    expect(headX(state.body)).toBe(0);
    expect(headY(state.body)).toBe(Math.floor(ROWS / 2));
  });

  it('wraps vertically too', () => {
    const state = startedGame({ wrap: true });
    moveOnce(state, [ACTIONS.UP]);
    while (headY(state.body) > 0) moveOnce(state);
    moveOnce(state);
    expect(headY(state.body)).toBe(ROWS - 1);
  });
});

describe('snake food spawn', () => {
  it('never lands on the snake', () => {
    const state = startedGame();
    for (let i = 0; i < 500; i++) {
      const cell = spawnFood(state.body.occupied, state.rand);
      expect(state.body.occupied[cell]).toBe(0);
    }
  });

  /**
   * The case rejection sampling fails: one free cell in four hundred. A
   * retry-until-free loop expects ~400 attempts here and has no upper bound.
   */
  it('finds the single free cell on a nearly full board', () => {
    const occupied = new Uint8Array(CELL_COUNT).fill(1);
    occupied[137] = 0;

    expect(spawnFood(occupied, () => 0)).toBe(137);
    expect(spawnFood(occupied, () => 0.999999)).toBe(137);
  });

  it('picks the kth free cell uniformly', () => {
    const occupied = new Uint8Array(10).fill(1);
    occupied[2] = 0;
    occupied[8] = 0;

    expect(spawnFood(occupied, () => 0)).toBe(2);
    expect(spawnFood(occupied, () => 0.6)).toBe(8);
  });

  it('reports a full board rather than looping', () => {
    const occupied = new Uint8Array(16).fill(1);
    expect(spawnFood(occupied, () => 0.5)).toBe(-1);
  });
});

describe('snake scoring and pace', () => {
  it('pays more per apple on faster tiers', () => {
    expect(applePoints(SPEEDS.TURTLE)).toBeLessThan(applePoints(SPEEDS.SNAKE));
    expect(applePoints(SPEEDS.SNAKE)).toBeLessThan(applePoints(SPEEDS.RABBIT));
  });

  it('throws on an unknown tier rather than guessing one', () => {
    expect(() => applePoints('SLUG')).toThrow();
    expect(() => moveIntervalMs('SLUG', 0)).toThrow();
  });

  it('shortens the interval as apples are eaten, and never below the floor', () => {
    let previous = moveIntervalMs(SPEEDS.SNAKE, 0);
    for (let apples = 1; apples <= 200; apples++) {
      const interval = moveIntervalMs(SPEEDS.SNAKE, apples);
      expect(interval <= previous).toBeTruthy();
      previous = interval;
    }

    const floor = SPEED_TABLE[SPEEDS.SNAKE].baseIntervalMs * INTERVAL_FLOOR_RATIO;
    expect(moveIntervalMs(SPEEDS.SNAKE, 10_000)).toBe(floor);
  });

  /**
   * The floor must stay above one 60Hz timestep. Below it, a single step would
   * owe more than one move and the snake would visibly skip cells.
   */
  it('keeps the fastest interval above one timestep', () => {
    const rabbit = SPEED_TABLE[SPEEDS.RABBIT];
    expect(rabbit.baseIntervalMs * INTERVAL_FLOOR_RATIO).toBeGreaterThan(1000 / 60);
  });

  it('scores an apple and grows the snake', () => {
    const state = startedGame();
    const before = state.body.length;
    state.food = cellIndex(11, 10);

    const events = moveOnce(state);
    expect(hasType(events, 'eat')).toBeTruthy();
    expect(state.body.length).toBe(before + 1);
    expect(state.score).toBe(applePoints(state.speed));
    expect(state.apples).toBe(1);
  });
});

describe('snake lifecycle', () => {
  /**
   * The bug this file did not catch the first time.
   *
   * The game boots into MENU, and every entry point into a run -- Play, Play
   * again, Enter -- funnels through one startNewGame() in main.js that
   * dispatches RESTART. RESTART was not a legal transition from MENU, and an
   * illegal transition is deliberately a silent no-op, so the Play button did
   * nothing and the game could never start.
   *
   * The suite missed it because its own helper starts games with START, and
   * the restart test below runs from PLAYING where RESTART was already legal.
   * A test has to use the action the UI sends, from the state the game boots
   * in, or it is testing a path nobody takes.
   */
  it('starts a run from the menu on the action the Play button sends', () => {
    const state = createGame({ seed: 7 });
    expect(state.fsm).toBe(STATES.MENU);

    const events = [];
    applyAction(state, ACTIONS.RESTART, events, 7);

    expect(state.fsm).toBe(STATES.PLAYING);
    expect(hasType(events, 'start')).toBeTruthy();
  });

  /** Same, for the other action that can begin a run. */
  it('starts a run from the menu on START', () => {
    const state = createGame({ seed: 7 });
    applyAction(state, ACTIONS.START, [], 7);
    expect(state.fsm).toBe(STATES.PLAYING);
  });

  it('actually moves the snake once started, without further prompting', () => {
    const state = createGame({ seed: 7 });
    applyAction(state, ACTIONS.RESTART, [], 7);
    const x = headX(state.body);

    step(state, state.moveIntervalMs, { actions: [] });

    expect(headX(state.body)).toBe(x + 1);
  });

  it('does not reset a game already in progress', () => {
    const state = startedGame();
    state.food = cellIndex(11, 10);
    moveOnce(state);
    const score = state.score;
    const x = headX(state.body);

    applyAction(state, ACTIONS.START, [], 99);

    expect(state.score).toBe(score);
    expect(headX(state.body)).toBe(x);
  });

  it('resets on restart', () => {
    const state = startedGame();
    state.food = cellIndex(11, 10);
    moveOnce(state);
    expect(state.score).toBeGreaterThan(0);

    applyAction(state, ACTIONS.RESTART, [], 99);

    expect(state.score).toBe(0);
    expect(state.apples).toBe(0);
    expect(state.fsm).toBe(STATES.PLAYING);
    expect(headX(state.body)).toBe(Math.floor(COLS / 2));
  });

  it('freezes the snake while paused', () => {
    const state = startedGame();
    const x = headX(state.body);
    applyAction(state, ACTIONS.PAUSE, []);

    step(state, 1000, { actions: [] });

    expect(headX(state.body)).toBe(x);
    expect(state.fsm).toBe(STATES.PAUSED);
  });

  it('toggles back out of pause', () => {
    const state = startedGame();
    applyAction(state, ACTIONS.PAUSE, []);
    applyAction(state, ACTIONS.PAUSE, []);
    expect(state.fsm).toBe(STATES.PLAYING);
  });

  it('applies a speed change only once the next run starts', () => {
    const state = startedGame();
    const during = state.moveIntervalMs;

    configure(state, { speed: SPEEDS.RABBIT });
    expect(state.moveIntervalMs).toBe(during);

    applyAction(state, ACTIONS.RESTART, [], 7);
    expect(state.moveIntervalMs).toBe(moveIntervalMs(SPEEDS.RABBIT, 0));
  });

  it('is deterministic for a given seed', () => {
    const a = createGame({ seed: 42 });
    const b = createGame({ seed: 42 });
    expect(a.food).toBe(b.food);

    const c = createGame({ seed: 43 });
    // Not a guarantee for every pair of seeds, but 42 and 43 do differ.
    expect(c.food === a.food).toBeFalsy();
  });
});
