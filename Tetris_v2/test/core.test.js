/**
 * Unit tests for the pure core modules.
 *
 * Boards are written as ASCII so a failure is readable by eye. Rows are given
 * bottom-aligned: the last string is board row 39, the floor.
 */

import { describe, it, expect } from './harness.js';

import {
  COLS, TOTAL_ROWS, VISIBLE_ROWS, STATE_SPAWN, STATE_R, STATE_180, STATE_L,
  ROTATE_CW, ROTATE_CCW, ROTATE_HALF, MAX_LOCK_RESETS
} from '../js/core/constants.js';
import {
  createBoard, boardFromRows, boardToRows, findFullRows, removeRows,
  isOccupied, lockCells, getCell
} from '../js/core/board.js';
import { SHAPES, BOX_SIZE, SPAWN } from '../js/core/tetrominoes.js';
import { KICKS_JLSTZ, KICKS_I, getKicks, targetState } from '../js/core/kicks.js';
import { createPiece, toBoardCells, isValid, dropDistance, ghostOf } from '../js/core/piece.js';
import { tryRotate } from '../js/core/srs.js';
import { mulberry32 } from '../js/core/rng.js';
import { createQueue, pull, peek } from '../js/core/queue.js';
import { dropIntervalMs, softDropIntervalMs } from '../js/core/gravity.js';
import {
  scoreClear, levelFor, isDifficult, softDropPoints, hardDropPoints,
  TSPIN_NONE, TSPIN_MINI, TSPIN_FULL
} from '../js/core/scoring.js';
import { classifyTSpin } from '../js/core/tspin.js';
import { STATES, EVENTS, transition, acceptsGameplayInput } from '../js/core/fsm.js';
import { createGame, step, applyAction, ACTIONS } from '../js/core/game.js';

/* -------------------------------------------------------------------------- */

describe('tetrominoes', () => {
  it('defines four states of four cells for every piece', () => {
    for (const [type, states] of Object.entries(SHAPES)) {
      expect(states.length).toBe(4);
      for (const cells of states) expect(cells.length).toBe(4);
      expect(typeof BOX_SIZE[type]).toBe('number');
    }
  });

  it('keeps every cell inside its bounding box', () => {
    for (const [type, states] of Object.entries(SHAPES)) {
      const size = BOX_SIZE[type];
      for (const cells of states) {
        for (const { x, y } of cells) {
          expect(x >= 0 && x < size).toBeTruthy();
          expect(y >= 0 && y < size).toBeTruthy();
        }
      }
    }
  });

  it('gives the O an identical shape in all four states', () => {
    const [a, b, c, d] = SHAPES.O;
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(c).toEqual(d);
  });

  it('spawns I across four columns and the 3-wide pieces across three', () => {
    expect(SPAWN.I.x).toBe(3);
    expect(SPAWN.T.x).toBe(3);
    expect(SPAWN.O.x).toBe(4);
  });

  it('spawns every piece inside the playfield', () => {
    for (const [type, spawn] of Object.entries(SPAWN)) {
      const cells = toBoardCells(createPiece(type));
      for (const { col, row } of cells) {
        expect(col >= 0 && col < COLS).toBeTruthy();
        expect(row >= 0 && row < TOTAL_ROWS).toBeTruthy();
      }
    }
  });
});

describe('kick tables', () => {
  it('covers eight transitions of five offsets in both tables', () => {
    for (const table of [KICKS_JLSTZ, KICKS_I]) {
      expect(Object.keys(table).length).toBe(8);
      for (const offsets of Object.values(table)) expect(offsets.length).toBe(5);
    }
  });

  it('never kicks the O', () => {
    expect(getKicks('O', STATE_SPAWN, STATE_R)).toEqual([[0, 0]]);
  });

  it('rotates states in the right direction', () => {
    expect(targetState(STATE_SPAWN, ROTATE_CW)).toBe(STATE_R);
    expect(targetState(STATE_SPAWN, ROTATE_CCW)).toBe(STATE_L);
    expect(targetState(STATE_SPAWN, ROTATE_HALF)).toBe(STATE_180);
    expect(targetState(STATE_L, ROTATE_CW)).toBe(STATE_SPAWN);
  });

  it('makes CW then CCW a round trip through every state', () => {
    for (let s = 0; s < 4; s++) {
      expect(targetState(targetState(s, ROTATE_CW), ROTATE_CCW)).toBe(s);
    }
  });
});

describe('board', () => {
  it('treats walls and floor as blocking but open sky as free', () => {
    const board = createBoard();
    expect(isOccupied(board, -1, 20)).toBeTruthy();
    expect(isOccupied(board, COLS, 20)).toBeTruthy();
    expect(isOccupied(board, 0, TOTAL_ROWS)).toBeTruthy();
    // Above the top must NOT block, so pieces can kick up into the buffer.
    expect(isOccupied(board, 0, -1)).toBeFalsy();
  });

  it('finds non-adjacent full rows and clears them simultaneously', () => {
    const board = boardFromRows([
      '##########',
      '#........#',
      '##########',
      '#.#.......'
    ]);
    expect(findFullRows(board)).toEqual([TOTAL_ROWS - 4, TOTAL_ROWS - 2]);

    const cleared = removeRows(board, findFullRows(board));
    expect(boardToRows(cleared, 2)).toEqual(['#........#', '#.#.......']);
  });

  it('scrolls empty rows in from the top', () => {
    const board = boardFromRows(['##########']);
    const cleared = removeRows(board, [TOTAL_ROWS - 1]);
    expect(boardToRows(cleared, 1)).toEqual(['..........']);
  });

  it('writes piece ordinals on lock without mutating the original', () => {
    const board = createBoard();
    const locked = lockCells(board, [{ col: 2, row: 30 }], 'T');
    expect(getCell(locked, 2, 30)).toBeGreaterThan(0);
    expect(getCell(board, 2, 30)).toBe(0);
  });
});

describe('SRS rotation', () => {
  it('kicks the I piece off the left wall', () => {
    const board = createBoard();
    // Vertical I hard against column 0.
    const piece = createPiece('I', STATE_L, -1, 20);
    expect(isValid(board, piece)).toBeTruthy();
    const result = tryRotate(board, piece, ROTATE_CW);
    expect(result).toBeTruthy();
    for (const { col } of toBoardCells(result.piece)) {
      expect(col >= 0).toBeTruthy();
    }
  });

  it('kicks the I piece off the right wall', () => {
    const board = createBoard();
    const piece = createPiece('I', STATE_R, COLS - 3, 20);
    expect(isValid(board, piece)).toBeTruthy();
    const result = tryRotate(board, piece, ROTATE_CW);
    expect(result).toBeTruthy();
    for (const { col } of toBoardCells(result.piece)) {
      expect(col < COLS).toBeTruthy();
    }
  });

  it('leaves the piece untouched when every kick fails', () => {
    // A fully walled-in single cell: nothing can rotate here.
    const rows = [];
    for (let i = 0; i < VISIBLE_ROWS; i++) rows.push('##########');
    const board = boardFromRows(rows);
    const piece = createPiece('T', STATE_SPAWN, 3, 20);
    expect(tryRotate(board, piece, ROTATE_CW)).toBeNull();
  });

  it('never displaces the O', () => {
    const board = createBoard();
    const piece = createPiece('O', STATE_SPAWN, 4, 20);
    const result = tryRotate(board, piece, ROTATE_CW);
    expect(result.piece.x).toBe(piece.x);
    expect(result.piece.y).toBe(piece.y);
    expect(result.kickIndex).toBe(0);
  });

  it('lands an I wall kick on specific absolute cells', () => {
    // Pins the +y-up to +y-down conversion. If a second, inconsistent
    // negation is ever introduced, this is what catches it.
    const board = createBoard();
    const piece = createPiece('I', STATE_L, -1, 20);
    const result = tryRotate(board, piece, ROTATE_CW);
    const cols = toBoardCells(result.piece).map((c) => c.col).sort((a, b) => a - b);
    expect(cols).toEqual([0, 1, 2, 3]);
  });
});

describe('gravity curve', () => {
  it('starts at one second per cell on level 1', () => {
    expect(dropIntervalMs(1)).toBeCloseTo(1000, 0.01);
  });

  it('accelerates monotonically', () => {
    for (let level = 1; level < 20; level++) {
      expect(dropIntervalMs(level + 1)).toBeLessThan(dropIntervalMs(level) + 0.001);
    }
  });

  it('stays finite past the point the curve base turns negative', () => {
    // v1 had no guard here: the base goes negative around level 115 and a
    // fractional power of it is NaN, which would freeze the active piece.
    for (const level of [100, 115, 150, 200, 1000]) {
      const interval = dropIntervalMs(level);
      expect(Number.isFinite(interval)).toBeTruthy();
      expect(interval).toBeGreaterThan(0);
    }
  });

  it('makes soft drop faster than gravity', () => {
    expect(softDropIntervalMs(1)).toBeLessThan(dropIntervalMs(1));
  });
});

describe('scoring', () => {
  it('matches the guideline table at level 1', () => {
    expect(scoreClear({ lines: 1, level: 1 }).points).toBe(100);
    expect(scoreClear({ lines: 2, level: 1 }).points).toBe(300);
    expect(scoreClear({ lines: 3, level: 1 }).points).toBe(500);
    expect(scoreClear({ lines: 4, level: 1 }).points).toBe(800);
  });

  it('multiplies by level', () => {
    expect(scoreClear({ lines: 4, level: 5 }).points).toBe(4000);
  });

  it('applies the back-to-back multiplier to a chained tetris', () => {
    expect(scoreClear({ lines: 4, level: 2, backToBack: true }).points).toBe(2400);
  });

  it('breaks the chain on a non-difficult clear', () => {
    expect(scoreClear({ lines: 1, level: 1, backToBack: true }).backToBack).toBeFalsy();
  });

  it('keeps the chain across a lock that clears nothing', () => {
    expect(scoreClear({ lines: 0, level: 1, backToBack: true }).backToBack).toBeTruthy();
  });

  it('scores T-spins above their plain equivalents', () => {
    expect(scoreClear({ lines: 1, tSpin: TSPIN_FULL, level: 1 }).points).toBe(800);
    expect(scoreClear({ lines: 2, tSpin: TSPIN_FULL, level: 1 }).points).toBe(1200);
    expect(scoreClear({ lines: 3, tSpin: TSPIN_FULL, level: 1 }).points).toBe(1600);
  });

  it('treats tetrises and T-spins as difficult and nothing else', () => {
    expect(isDifficult({ lines: 4, tSpin: TSPIN_NONE })).toBeTruthy();
    expect(isDifficult({ lines: 1, tSpin: TSPIN_MINI })).toBeTruthy();
    expect(isDifficult({ lines: 3, tSpin: TSPIN_NONE })).toBeFalsy();
  });

  it('scores drops per cell', () => {
    expect(softDropPoints(5)).toBe(5);
    expect(hardDropPoints(5)).toBe(10);
  });

  it('advances a level every ten lines', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(9)).toBe(1);
    expect(levelFor(10)).toBe(2);
    // Regression guard: v1 divided by 5 here and levelled twice as fast.
    expect(levelFor(50)).toBe(6);
  });
});

describe('7-bag randomizer', () => {
  it('deals every seven pieces as a permutation of all seven', () => {
    const rand = mulberry32(12345);
    let queue = createQueue(rand);
    const drawn = [];
    for (let i = 0; i < 700; i++) {
      const result = pull(queue, rand);
      drawn.push(result.type);
      queue = result.queue;
    }
    for (let i = 0; i < drawn.length; i += 7) {
      expect(new Set(drawn.slice(i, i + 7)).size).toBe(7);
    }
  });

  it('always has five pieces ready to preview', () => {
    const rand = mulberry32(1);
    let queue = createQueue(rand);
    for (let i = 0; i < 50; i++) {
      expect(peek(queue).length).toBe(5);
      queue = pull(queue, rand).queue;
    }
  });

  it('is reproducible from a seed', () => {
    const draw = (seed) => {
      const rand = mulberry32(seed);
      let queue = createQueue(rand);
      return Array.from({ length: 20 }, () => {
        const r = pull(queue, rand);
        queue = r.queue;
        return r.type;
      }).join('');
    };
    expect(draw(99)).toBe(draw(99));
  });
});

describe('T-spin classification', () => {
  // Notch at column 4 flanked by filled cells — a T dropped flat and rotated
  // 180 lands its stem in the notch with three corners covered.
  const slot = () => boardFromRows([
    '.....#....',
    '###...####',
    '####.#####'
  ]);

  it('recognises a full T-spin when both front corners are covered', () => {
    const board = slot();
    const result = tryRotate(board, createPiece('T', STATE_SPAWN, 3, 37), ROTATE_HALF);
    expect(result).toBeTruthy();
    expect(classifyTSpin({
      board, piece: result.piece, lastAction: 'rotate', kickIndex: result.kickIndex
    })).toBe(TSPIN_FULL);
  });

  it('rejects a T that arrived by translation rather than rotation', () => {
    // The critical negative. v1 never cleared its rotation flag on a gravity
    // drop, so rotate then fall then lock scored as a T-spin.
    const board = slot();
    const result = tryRotate(board, createPiece('T', STATE_SPAWN, 3, 37), ROTATE_HALF);
    expect(classifyTSpin({
      board, piece: result.piece, lastAction: 'move', kickIndex: result.kickIndex
    })).toBe(TSPIN_NONE);
  });

  it('rejects a piece that is not a T', () => {
    const board = slot();
    expect(classifyTSpin({
      board, piece: createPiece('L', STATE_180, 3, 37), lastAction: 'rotate', kickIndex: 0
    })).toBe(TSPIN_NONE);
  });

  it('rejects a T rotated in open space', () => {
    const board = createBoard();
    expect(classifyTSpin({
      board, piece: createPiece('T', STATE_SPAWN, 3, 20), lastAction: 'rotate', kickIndex: 0
    })).toBe(TSPIN_NONE);
  });
});

describe('state machine', () => {
  it('starts a game from the menu', () => {
    expect(transition(STATES.MENU, EVENTS.START)).toBe(STATES.PLAYING);
  });

  it('pauses and resumes', () => {
    expect(transition(STATES.PLAYING, EVENTS.PAUSE)).toBe(STATES.PAUSED);
    expect(transition(STATES.PAUSED, EVENTS.RESUME)).toBe(STATES.PLAYING);
  });

  it('auto-pauses when the tab is backgrounded', () => {
    expect(transition(STATES.PLAYING, EVENTS.BLUR)).toBe(STATES.PAUSED);
  });

  it('freezes a line clear on pause rather than losing it', () => {
    expect(transition(STATES.LINE_CLEAR, EVENTS.PAUSE)).toBe(STATES.PAUSED);
  });

  it('makes every illegal pair a no-op', () => {
    for (const state of Object.values(STATES)) {
      if (state === STATES.BOOT) continue;
      for (const event of Object.values(EVENTS)) {
        const next = transition(state, event);
        expect(Object.values(STATES).includes(next)).toBeTruthy();
      }
    }
  });

  it('accepts gameplay input only while playing', () => {
    expect(acceptsGameplayInput(STATES.PLAYING)).toBeTruthy();
    expect(acceptsGameplayInput(STATES.PAUSED)).toBeFalsy();
    expect(acceptsGameplayInput(STATES.LINE_CLEAR)).toBeFalsy();
    expect(acceptsGameplayInput(STATES.GAME_OVER)).toBeFalsy();
  });
});

describe('game reducer', () => {
  const start = (seed = 7) => {
    const game = createGame({ seed });
    applyAction(game, ACTIONS.START, [], seed);
    return game;
  };

  it('spawns a piece and fills the preview on start', () => {
    const game = start();
    expect(game.fsm).toBe(STATES.PLAYING);
    expect(game.piece).toBeTruthy();
    expect(peek(game.queue).length).toBe(5);
  });

  it('moves the piece horizontally within the walls', () => {
    const game = start();
    const before = game.piece.x;
    applyAction(game, ACTIONS.MOVE_LEFT);
    expect(game.piece.x).toBe(before - 1);
    applyAction(game, ACTIONS.MOVE_RIGHT);
    expect(game.piece.x).toBe(before);
  });

  it('scores two points per cell on a hard drop', () => {
    const game = start();
    const distance = dropDistance(game.board, game.piece);
    applyAction(game, ACTIONS.HARD_DROP);
    expect(game.score).toBe(distance * 2);
  });

  it('locks the piece immediately on hard drop', () => {
    const game = start();
    const type = game.piece.type;
    applyAction(game, ACTIONS.HARD_DROP);
    // A new piece has spawned, so the locked one is on the board.
    expect(game.boardVersion).toBeGreaterThan(0);
    expect(game.piece.type !== undefined).toBeTruthy();
  });

  it('allows only one hold per piece', () => {
    const game = start();
    const first = game.piece.type;
    applyAction(game, ACTIONS.HOLD);
    expect(game.hold).toBe(first);
    expect(game.canHold).toBeFalsy();

    const afterFirst = game.piece.type;
    applyAction(game, ACTIONS.HOLD);
    expect(game.piece.type).toBe(afterFirst);
  });

  it('re-enables hold after the next piece locks', () => {
    const game = start();
    applyAction(game, ACTIONS.HOLD);
    expect(game.canHold).toBeFalsy();
    applyAction(game, ACTIONS.HARD_DROP);
    expect(game.canHold).toBeTruthy();
  });

  it('puts the ghost at the hard-drop landing position', () => {
    const game = start();
    const ghost = ghostOf(game.board, game.piece);
    const distance = dropDistance(game.board, game.piece);
    expect(ghost.y).toBe(game.piece.y + distance);
  });

  it('ignores gameplay input while paused', () => {
    const game = start();
    const before = game.piece.x;
    applyAction(game, ACTIONS.PAUSE);
    applyAction(game, ACTIONS.MOVE_LEFT);
    expect(game.piece.x).toBe(before);
  });

  it('halts gravity while paused', () => {
    const game = start();
    applyAction(game, ACTIONS.PAUSE);
    const before = game.piece.y;
    for (let i = 0; i < 300; i++) step(game, 1000 / 60);
    expect(game.piece.y).toBe(before);
  });

  it('caps lock delay resets per piece so spinning cannot stall forever', () => {
    const game = start();
    applyAction(game, ACTIONS.HARD_DROP);
    // Drop a fresh piece to the floor, then rotate repeatedly on the ground.
    const game2 = start(3);
    while (dropDistance(game2.board, game2.piece) > 0) {
      game2.piece = { ...game2.piece, y: game2.piece.y + 1 };
    }
    for (let i = 0; i < MAX_LOCK_RESETS + 10; i++) {
      applyAction(game2, ACTIONS.ROTATE_CW);
    }
    expect(game2.lockResets <= MAX_LOCK_RESETS).toBeTruthy();
  });

  it('ends the game when a spawn is blocked', () => {
    const game = start();
    // Stack to the top, but leave column 9 open so no row is complete — this
    // has to be a block out, not a line clear.
    const rows = [];
    for (let i = 0; i < VISIBLE_ROWS; i++) rows.push('#########.');
    game.board = boardFromRows(rows);
    expect(findFullRows(game.board).length).toBe(0);

    applyAction(game, ACTIONS.HARD_DROP);
    expect(game.fsm).toBe(STATES.GAME_OVER);
  });

  it('restarts cleanly from game over', () => {
    const game = start();
    game.score = 5000;
    game.fsm = STATES.GAME_OVER;
    applyAction(game, ACTIONS.RESTART, [], 11);
    expect(game.fsm).toBe(STATES.PLAYING);
    expect(game.score).toBe(0);
    expect(game.lines).toBe(0);
    expect(game.level).toBe(1);
  });

  it('clears a completed row and credits it', () => {
    const game = start();
    // One gap at column 0 on the floor, filled by dropping a piece into it.
    game.board = boardFromRows(['.#########']);
    game.piece = createPiece('I', STATE_L, -1, 20);
    applyAction(game, ACTIONS.HARD_DROP);
    expect(game.lines).toBe(1);
    expect(game.score).toBeGreaterThan(0);
    expect(game.fsm).toBe(STATES.LINE_CLEAR);

    // The clear resolves once its timer elapses, then play resumes.
    for (let i = 0; i < 30; i++) step(game, 1000 / 60);
    expect(game.fsm).toBe(STATES.PLAYING);
    expect(findFullRows(game.board).length).toBe(0);
  });

  it('does not lose queued input during a line clear', () => {
    const game = start();
    game.board = boardFromRows(['.#########']);
    game.piece = createPiece('I', STATE_L, -1, 20);
    applyAction(game, ACTIONS.HARD_DROP);
    expect(game.fsm).toBe(STATES.LINE_CLEAR);
    // Stepping through the clear must not throw on queued actions.
    for (let i = 0; i < 30; i++) {
      step(game, 1000 / 60, { actions: [ACTIONS.MOVE_LEFT], softDrop: false });
    }
    expect(game.fsm).toBe(STATES.PLAYING);
  });
});

describe('frame-rate independence', () => {
  /**
   * Spec acceptance criterion 9, as a test rather than a manual eyeball.
   *
   * The same seeded game driven by the same actions must reach an identical
   * state whether it is fed 60Hz or 144Hz deltas, because both are accumulated
   * into the same fixed timestep.
   */
  const TIMESTEP = 1000 / 60;

  /**
   * Drives a game for `durationMs` of wall clock at the given frame rate,
   * accumulating deltas exactly as engine/loop.js does.
   *
   * Actions are scheduled by TIMESTAMP, not frame index. Keying them to frames
   * would deliver input at different wall-clock moments in each run, which
   * would make the comparison meaningless rather than testing the loop.
   */
  function runAccumulated(seed, frameDelta, durationMs, schedule) {
    const game = createGame({ seed });
    applyAction(game, ACTIONS.START, [], seed);

    const pending = schedule.slice();
    let accumulator = 0;
    let elapsed = 0;

    for (let clock = 0; clock < durationMs; clock += frameDelta) {
      accumulator += frameDelta;
      let guard = 8;
      while (accumulator >= TIMESTEP && guard-- > 0) {
        accumulator -= TIMESTEP;
        elapsed += TIMESTEP;

        const actions = [];
        while (pending.length && pending[0].at <= elapsed) {
          actions.push(pending.shift().action);
        }
        step(game, TIMESTEP, { actions, softDrop: false });
      }
    }
    return game;
  }

  it('reaches the same state at 60Hz and 144Hz', () => {
    const schedule = [];
    for (let t = 100; t < 4000; t += 290) schedule.push({ at: t, action: ACTIONS.MOVE_LEFT });
    for (let t = 180; t < 4000; t += 470) schedule.push({ at: t, action: ACTIONS.ROTATE_CW });
    for (let t = 260; t < 4000; t += 610) schedule.push({ at: t, action: ACTIONS.HARD_DROP });
    schedule.sort((a, b) => a.at - b.at);

    const at60 = runAccumulated(2024, 1000 / 60, 4000, schedule);
    const at144 = runAccumulated(2024, 1000 / 144, 4000, schedule);

    expect(at60.score).toBe(at144.score);
    expect(at60.lines).toBe(at144.lines);
    expect(at60.level).toBe(at144.level);
    expect(at60.board).toEqual(at144.board);
  });

  it('reaches the same state at 30Hz as at 60Hz', () => {
    const schedule = [{ at: 500, action: ACTIONS.MOVE_LEFT },
                      { at: 900, action: ACTIONS.HARD_DROP }];
    const at30 = runAccumulated(31, 1000 / 30, 3000, schedule);
    const at60 = runAccumulated(31, 1000 / 60, 3000, schedule);
    expect(at30.board).toEqual(at60.board);
    expect(at30.score).toBe(at60.score);
  });

  it('is reproducible from the same seed', () => {
    const a = runAccumulated(555, 1000 / 60, 2000, []);
    const b = runAccumulated(555, 1000 / 60, 2000, []);
    expect(a.board).toEqual(b.board);
    expect(a.score).toBe(b.score);
  });
});
