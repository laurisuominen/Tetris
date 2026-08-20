/**
 * Chomp core.
 *
 * This game is the most testable in the repo and the tests lean on that hard.
 * Ghost targeting is a pure function of integers with no randomness, so the
 * documented arcade behaviour can be asserted exactly rather than approximated —
 * "Pinky aims four ahead" becomes a coordinate, not a vibe.
 *
 * Constants are IMPORTED, never retyped. A test that hard-codes 8 for Clyde's
 * radius keeps passing after someone changes the constant to 6.
 *
 * Not covered: the renderer, input and UI, all of which need a document. What
 * they would catch is a broken import path, and the definition of done covers
 * that with a network-panel check against the deployed origin instead.
 */

import { describe, it, expect } from './harness.js';

import {
  COLS, ROWS, MAZE_TOP, MAZE_BOTTOM, MAZE_ROWS, UP, LEFT, DOWN, RIGHT, DIRS,
  OPPOSITE, GHOST, SCATTER_TARGETS, CLYDE_SHY_DISTANCE, TUNNEL_ROW,
  RED_ZONE_ROWS, RED_ZONE_X_MIN, RED_ZONE_X_MAX, TOTAL_DOTS, TOTAL_ENERGIZERS,
  GHOST_CHAIN, START_LIVES, EXTRA_LIFE_AT, MAX_LEVEL, BASE_SPEED,
  PLAYER_CORNER_TOLERANCE, PLAYER_START, HOUSE_DOOR, GLOBAL_RELEASE,
  FRUIT_AT_DOTS, SPEED_BANDS
} from '../js/games/chomp/core/constants.js';
import { MAZE_ROWS_TEXT, validateMaze, WALL, DOOR } from '../js/games/chomp/core/mazeData.js';
import {
  tileAt, isWalkable, isWalkableByPlayer, isTunnel, isRedZone,
  createPellets, resetPellets, pelletAt, eatPellet, PELLET
} from '../js/games/chomp/core/maze.js';
import { targetTile, aheadOf, MODE, elroyIgnoresScatter } from '../js/games/chomp/core/targeting.js';
import { bestDirection } from '../js/games/chomp/core/ghosts.js';
import { createModeState, stepModes } from '../js/games/chomp/core/modes.js';
import {
  createHouse, onDotEaten, onDeath, stepIdle, shouldRelease
} from '../js/games/chomp/core/house.js';
import {
  fruitFor, frightFor, elroyFor, speedsFor, houseLimitsFor, phasesFor, releaseTimeoutFor
} from '../js/games/chomp/core/levels.js';
import { ghostPoints, boardPelletPoints, maxBoardPoints } from '../js/games/chomp/core/scoring.js';
import { createActor, advance, tryTurn, tileOf } from '../js/games/chomp/core/actor.js';
import { createGame, step, applyAction, ACTIONS } from '../js/games/chomp/core/game.js';
import { STATES, transition, EVENTS, isRunning } from '../js/games/chomp/core/fsm.js';

const FRAME = 1000 / 60;

const at = (x, y) => ({ x, y });
const pacAt = (tileX, tileY, dir) => ({ tileX, tileY, dir });
const tileEq = (a, b) => a.x === b.x && a.y === b.y;

function playing() {
  const s = createGame({});
  applyAction(s, ACTIONS.RESTART, []);
  return s;
}

/** Runs frames, returns every event raised. */
function run(state, frames, input = {}) {
  const seen = [];
  for (let i = 0; i < frames && state.fsm === STATES.PLAYING; i += 1) {
    const { events } = step(state, FRAME, input);
    for (const e of events) seen.push(e);
  }
  return seen;
}

const typesOf = (events) => events.map((e) => e.type);

/* -------------------------------------------------------------------------- */

describe('the board', () => {
  it('is structurally sound: 28x31, 240 dots, 4 energizers', () => {
    expect(validateMaze()).toEqual([]);
  });

  it('lays exactly 244 pellets', () => {
    const pellets = createPellets();
    expect(resetPellets(pellets)).toBe(TOTAL_DOTS + TOTAL_ENERGIZERS);
  });

  it('puts the four energizers in the four corners of the maze', () => {
    const pellets = createPellets();
    resetPellets(pellets);
    const found = [];
    for (let y = MAZE_TOP; y <= MAZE_BOTTOM; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (pelletAt(pellets, x, y) === PELLET.ENERGIZER) found.push(`${x},${y}`);
      }
    }
    expect(found.length).toBe(4);
    // Two near the top, two near the bottom; one on each side.
    const left = found.filter((f) => Number(f.split(',')[0]) < COLS / 2).length;
    expect(left).toBe(2);
  });

  it('leaves the tunnel row open to both edges', () => {
    // The wrap only makes sense if a player can actually reach both ends.
    expect(isWalkable(0, TUNNEL_ROW)).toBeTruthy();
    expect(isWalkable(COLS - 1, TUNNEL_ROW)).toBeTruthy();
    expect(isTunnel(0, TUNNEL_ROW)).toBeTruthy();
    expect(isTunnel(COLS - 1, TUNNEL_ROW)).toBeTruthy();
    expect(isTunnel(14, TUNNEL_ROW)).toBeFalsy();
  });

  it('places both red zones on walkable corridor, not inside walls', () => {
    // A red zone inside a wall would be dead code that silently does nothing.
    for (const y of RED_ZONE_ROWS) {
      for (let x = RED_ZONE_X_MIN; x <= RED_ZONE_X_MAX; x += 1) {
        expect(`${x},${y}:${isRedZone(x, y)}`).toBe(`${x},${y}:true`);
      }
    }
    expect(isRedZone(14, 20)).toBeFalsy();
    expect(isRedZone(2, RED_ZONE_ROWS[0])).toBeFalsy();
  });

  it('starts the player on open floor, and never lets them through the door', () => {
    expect(isWalkableByPlayer(PLAYER_START.x, Math.floor(PLAYER_START.y))).toBeTruthy();

    let doors = 0;
    for (let y = MAZE_TOP; y <= MAZE_BOTTOM; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (tileAt(x, y) !== DOOR) continue;
        doors += 1;
        expect(isWalkableByPlayer(x, y)).toBeFalsy();
        expect(isWalkable(x, y)).toBeTruthy();   // ghosts may
      }
    }
    expect(doors).toBeGreaterThan(0);
  });

  it('treats the dead space outside the maze as not-wall, so scatter targets are reachable as DISTANCES', () => {
    // Blinky aims at (25,0), which is above the maze. It must not read as a wall.
    expect(tileAt(25, 0)).toBe(' ');
    expect(tileAt(0, ROWS - 2)).toBe(' ');
  });
});

describe('targeting — the four programs', () => {
  const blinky = { tileX: 20, tileY: 20 };

  it('sends Blinky straight at the player', () => {
    const t = targetTile(GHOST.BLINKY, MODE.CHASE, pacAt(10, 20, LEFT), {}, blinky);
    expect(tileEq(t, at(10, 20))).toBeTruthy();
  });

  it('sends Pinky four tiles ahead', () => {
    expect(tileEq(targetTile(GHOST.PINKY, MODE.CHASE, pacAt(10, 20, LEFT), {}, blinky), at(6, 20))).toBeTruthy();
    expect(tileEq(targetTile(GHOST.PINKY, MODE.CHASE, pacAt(10, 20, RIGHT), {}, blinky), at(14, 20))).toBeTruthy();
    expect(tileEq(targetTile(GHOST.PINKY, MODE.CHASE, pacAt(10, 20, DOWN), {}, blinky), at(10, 24))).toBeTruthy();
  });

  it('reproduces the UP overflow: four ahead is also four LEFT', () => {
    // The bug. Classic ambush behaviour and several safe spots depend on it.
    const t = targetTile(GHOST.PINKY, MODE.CHASE, pacAt(10, 20, UP), {}, blinky, false);
    expect(tileEq(t, at(6, 16))).toBeTruthy();
  });

  it('corrects the overflow when modern is on, and ONLY then', () => {
    const t = targetTile(GHOST.PINKY, MODE.CHASE, pacAt(10, 20, UP), {}, blinky, true);
    expect(tileEq(t, at(10, 16))).toBeTruthy();

    // Every other direction is identical either way — modern is not a difficulty
    // setting, it is two offsets.
    for (const dir of [LEFT, RIGHT, DOWN]) {
      const arcade = targetTile(GHOST.PINKY, MODE.CHASE, pacAt(10, 20, dir), {}, blinky, false);
      const modern = targetTile(GHOST.PINKY, MODE.CHASE, pacAt(10, 20, dir), {}, blinky, true);
      expect(tileEq(arcade, modern)).toBeTruthy();
    }
  });

  it('doubles Inky’s vector from Blinky through the two-ahead tile', () => {
    // Player (10,20) facing LEFT -> pivot (8,20). Blinky (20,20).
    // Vector (-12, 0) doubled from the pivot -> (-4, 20).
    const t = targetTile(GHOST.INKY, MODE.CHASE, pacAt(10, 20, LEFT), {}, { tileX: 20, tileY: 20 });
    expect(tileEq(t, at(-4, 20))).toBeTruthy();
  });

  it('makes Inky harmless when Blinky is far and vicious when Blinky is close', () => {
    const pac = pacAt(10, 20, LEFT);
    const far = targetTile(GHOST.INKY, MODE.CHASE, pac, {}, { tileX: 27, tileY: 3 });
    const near = targetTile(GHOST.INKY, MODE.CHASE, pac, {}, { tileX: 9, tileY: 20 });
    // With Blinky right beside the player, Inky's target is near the player too.
    const nearDist = Math.abs(near.x - 10) + Math.abs(near.y - 20);
    const farDist = Math.abs(far.x - 10) + Math.abs(far.y - 20);
    expect(nearDist).toBeLessThan(farDist);
  });

  it('carries Inky’s up-bug too', () => {
    const arcade = targetTile(GHOST.INKY, MODE.CHASE, pacAt(10, 20, UP), {}, blinky, false);
    const modern = targetTile(GHOST.INKY, MODE.CHASE, pacAt(10, 20, UP), {}, blinky, true);
    expect(tileEq(arcade, modern)).toBeFalsy();
  });

  it('flips Clyde at exactly eight tiles', () => {
    const pac = pacAt(10, 20, LEFT);
    const corner = SCATTER_TARGETS[GHOST.CLYDE];

    const justInside = targetTile(GHOST.CLYDE, MODE.CHASE, pac, { tileX: 10 - (CLYDE_SHY_DISTANCE - 1), tileY: 20 }, blinky);
    expect(tileEq(justInside, corner)).toBeTruthy();

    const exactly = targetTile(GHOST.CLYDE, MODE.CHASE, pac, { tileX: 10 - CLYDE_SHY_DISTANCE, tileY: 20 }, blinky);
    expect(tileEq(exactly, at(10, 20))).toBeTruthy();
  });

  it('ignores everything but the corner in scatter mode', () => {
    for (const g of [GHOST.BLINKY, GHOST.PINKY, GHOST.INKY, GHOST.CLYDE]) {
      const t = targetTile(g, MODE.SCATTER, pacAt(10, 20, LEFT), { tileX: 1, tileY: 1 }, blinky);
      expect(tileEq(t, SCATTER_TARGETS[g])).toBeTruthy();
    }
  });

  it('puts every scatter target outside the maze, so none is ever reached', () => {
    for (const t of SCATTER_TARGETS) {
      const outside = t.y < MAZE_TOP || t.y > MAZE_BOTTOM;
      expect(`${t.x},${t.y}:${outside}`).toBe(`${t.x},${t.y}:true`);
    }
  });

  it('lets Elroy Blinky ignore scatter, and nobody else', () => {
    expect(elroyIgnoresScatter(GHOST.BLINKY, 1)).toBeTruthy();
    expect(elroyIgnoresScatter(GHOST.BLINKY, 0)).toBeFalsy();
    expect(elroyIgnoresScatter(GHOST.PINKY, 2)).toBeFalsy();
  });

  it('offsets ahead correctly in every direction', () => {
    expect(tileEq(aheadOf(5, 5, RIGHT, 3), at(8, 5))).toBeTruthy();
    expect(tileEq(aheadOf(5, 5, DOWN, 3), at(5, 8))).toBeTruthy();
    expect(tileEq(aheadOf(5, 5, UP, 3, true), at(5, 2))).toBeTruthy();
    expect(tileEq(aheadOf(5, 5, UP, 3, false), at(2, 2))).toBeTruthy();
  });
});

describe('steering', () => {
  const open = () => true;
  const walls = (blocked) => (x, y) => !blocked.includes(`${x},${y}`);

  it('takes the direction that ends closest to the target', () => {
    expect(bestDirection(10, 20, LEFT, at(10, 10), open, true)).toBe(UP);
    expect(bestDirection(10, 20, UP, at(20, 20), open, true)).toBe(RIGHT);
  });

  it('never reverses', () => {
    // Target is directly behind, but turning back is not an option.
    const chosen = bestDirection(10, 20, RIGHT, at(0, 20), open, true);
    expect(chosen).toBe(OPPOSITE[RIGHT] === chosen ? -1 : chosen);
    expect(chosen === LEFT).toBeFalsy();
  });

  it('breaks ties up, then left, then down, then right', () => {
    // Target on the ghost's own tile: every neighbour is equidistant, so the
    // first legal one in DIRS order wins.
    //
    // Travelling RIGHT, so LEFT is the reverse and excluded — the candidates are
    // up, down, right, and up must win.
    expect(bestDirection(10, 20, RIGHT, at(10, 20), open, true)).toBe(UP);
    // With up refused by a red zone, down is the next in order.
    expect(bestDirection(10, 20, RIGHT, at(10, 20), open, false)).toBe(DOWN);
  });

  it('refuses to turn up inside a red zone', () => {
    const target = at(10, 0);   // straight up
    expect(bestDirection(10, 20, LEFT, target, open, true)).toBe(UP);
    expect(bestDirection(10, 20, LEFT, target, open, false)).toBeLessThan(4);
    expect(bestDirection(10, 20, LEFT, target, open, false) === UP).toBeFalsy();
  });

  it('reverses only when genuinely boxed in', () => {
    // A true dead end travelling RIGHT: ahead, above and below are all wall, and
    // the only open neighbour is the tile behind. Returning -1 here would be a
    // silent freeze, so the fallback has to reverse.
    const blocked = walls(['10,19', '11,20', '10,21']);
    expect(bestDirection(10, 20, RIGHT, at(0, 0), blocked, true)).toBe(OPPOSITE[RIGHT]);
  });
});

describe('the scatter/chase schedule', () => {
  it('starts every level in scatter', () => {
    for (const level of [1, 2, 5, 21]) {
      expect(createModeState(level).mode).toBe(MODE.SCATTER);
    }
  });

  it('switches to chase after seven seconds on level 1, five from level 5', () => {
    const one = createModeState(1);
    let switched = 0;
    for (let i = 0; i < 60 * 7 - 1; i += 1) if (stepModes(one, FRAME)) switched += 1;
    expect(switched).toBe(0);
    for (let i = 0; i < 3; i += 1) if (stepModes(one, FRAME)) switched += 1;
    expect(switched).toBe(1);
    expect(one.mode).toBe(MODE.CHASE);

    const five = createModeState(5);
    let earlier = 0;
    for (let i = 0; i < 60 * 5 + 2; i += 1) if (stepModes(five, FRAME)) earlier += 1;
    expect(earlier).toBe(1);
  });

  it('keeps the one-frame scatter at levels 2+, which exists only to force a reversal', () => {
    // Rounding it to zero would silently remove a reversal players rely on.
    const phases = phasesFor(5);
    expect(phases[6]).toBeLessThan(0.02);
    expect(phases[6]).toBeGreaterThan(0);
  });

  it('ends every level in a chase that never expires', () => {
    for (const level of [1, 3, 9]) {
      const phases = phasesFor(level);
      expect(phases[phases.length - 1]).toBe(Infinity);
    }
  });

  it('freezes while frightened, so the clock resumes where it left off', () => {
    const s = createModeState(1);
    for (let i = 0; i < 60 * 3; i += 1) stepModes(s, FRAME);
    const elapsed = s.elapsedS;
    for (let i = 0; i < 60 * 5; i += 1) stepModes(s, FRAME, true);
    expect(s.elapsedS).toBeCloseTo(elapsed, 1e-9);
  });
});

describe('the ghost house', () => {
  const nobodyHome = () => false;
  const everyoneHome = () => true;

  it('lets Pinky out immediately and holds Clyde back on level 1', () => {
    const limits = houseLimitsFor(1);
    expect(limits[GHOST.PINKY]).toBe(0);
    expect(limits[GHOST.INKY]).toBe(30);
    expect(limits[GHOST.CLYDE]).toBe(60);
  });

  it('opens the house from level 3', () => {
    expect(houseLimitsFor(3)).toEqual([0, 0, 0, 0]);
  });

  it('advances only the most-preferred waiting ghost’s counter', () => {
    // Cumulative in effect, not parallel — this is why the limits work.
    const house = createHouse(1);
    for (let i = 0; i < 10; i += 1) onDotEaten(house, everyoneHome);
    expect(house.counters[GHOST.PINKY]).toBe(10);
    expect(house.counters[GHOST.INKY]).toBe(0);

    const pinkyOut = (g) => g !== GHOST.PINKY;
    for (let i = 0; i < 5; i += 1) onDotEaten(house, pinkyOut);
    expect(house.counters[GHOST.INKY]).toBe(5);
  });

  it('releases on the personal limit', () => {
    const house = createHouse(1);
    expect(shouldRelease(house, GHOST.INKY, everyoneHome)).toBeFalsy();
    const pinkyOut = (g) => g !== GHOST.PINKY;
    for (let i = 0; i < 30; i += 1) onDotEaten(house, pinkyOut);
    expect(shouldRelease(house, GHOST.INKY, everyoneHome)).toBeTruthy();
  });

  it('switches to the global counter after a death', () => {
    const house = createHouse(1);
    onDeath(house);
    expect(house.useGlobal).toBeTruthy();
    for (let i = 0; i < GLOBAL_RELEASE[GHOST.PINKY]; i += 1) onDotEaten(house, everyoneHome);
    expect(shouldRelease(house, GHOST.PINKY, everyoneHome)).toBeTruthy();
    expect(shouldRelease(house, GHOST.INKY, everyoneHome)).toBeFalsy();
  });

  it('retires the global counter once Clyde’s mark is passed', () => {
    const house = createHouse(1);
    onDeath(house);
    const clydeOut = (g) => g !== GHOST.CLYDE;
    for (let i = 0; i < GLOBAL_RELEASE[GHOST.CLYDE] + 1; i += 1) onDotEaten(house, clydeOut);
    expect(house.useGlobal).toBeFalsy();
  });

  it('forces the first waiting ghost out when no dot is eaten for long enough', () => {
    const house = createHouse(1);
    expect(shouldRelease(house, GHOST.CLYDE, everyoneHome)).toBeFalsy();
    stepIdle(house, releaseTimeoutFor(1) + 1);
    // Pinky is most preferred, so she goes — not Clyde.
    expect(shouldRelease(house, GHOST.PINKY, everyoneHome)).toBeTruthy();
    expect(shouldRelease(house, GHOST.CLYDE, everyoneHome)).toBeFalsy();
  });

  it('shortens the failsafe from level 5', () => {
    expect(releaseTimeoutFor(5)).toBeLessThan(releaseTimeoutFor(4));
  });

  it('never holds Blinky, who is not in the house', () => {
    expect(shouldRelease(createHouse(1), GHOST.BLINKY, everyoneHome)).toBeTruthy();
  });
});

describe('per-level tables', () => {
  it('walks the fruit from cherries to the key', () => {
    expect(fruitFor(1)).toEqual({ name: 'CHERRY', points: 100 });
    expect(fruitFor(13).points).toBe(5000);
    expect(fruitFor(99).points).toBe(5000);
  });

  it('shrinks frightened time to nothing by the late levels', () => {
    expect(frightFor(1).seconds).toBe(6);
    expect(frightFor(1).flashes).toBe(5);
    expect(frightFor(17).seconds).toBe(0);
    expect(frightFor(19).seconds).toBe(0);
    expect(frightFor(200).seconds).toBe(0);
  });

  it('brings Cruise Elroy earlier as the levels climb', () => {
    expect(elroyFor(1).one).toBe(20);
    expect(elroyFor(1).two).toBe(10);
    expect(elroyFor(19).one).toBeGreaterThan(elroyFor(1).one);
    for (const level of [1, 5, 10, 21]) {
      expect(elroyFor(level).two).toBeLessThan(elroyFor(level).one);
    }
  });

  it('makes ghosts slower than the player until level 21', () => {
    for (const level of [1, 3, 10]) {
      const s = speedsFor(level);
      expect(s.ghost).toBeLessThan(s.player);
    }
    const late = speedsFor(21);
    expect(late.player).toBeLessThan(late.ghost);
  });

  it('always slows the player over a dot', () => {
    // The only reason ghosts ever close the gap.
    for (const band of SPEED_BANDS) expect(band.playerDots).toBeLessThan(band.player);
  });
});

describe('scoring', () => {
  it('doubles the chain per ghost and resets per energizer', () => {
    expect(GHOST_CHAIN).toEqual([200, 400, 800, 1600]);
    expect(ghostPoints(0)).toBe(200);
    expect(ghostPoints(3)).toBe(1600);
    // A fifth ghost is impossible, but must not be NaN.
    expect(ghostPoints(9)).toBe(1600);
  });

  it('makes a perfect board of pellets worth 2,600', () => {
    expect(boardPelletPoints()).toBe(2600);
  });

  it('caps a single board at 24,600, which is what submit-score is derived from', () => {
    expect(maxBoardPoints()).toBe(24_600);
  });
});

describe('movement', () => {
  const open = () => true;

  it('stops flush at a wall, ON the tile centre so a turn stays legal', () => {
    // Stopping short is the classic feel bug: the player is held against a wall
    // and cannot turn because they are not near enough to a centre.
    const wallAt = (x) => (tx) => tx !== x;
    const a = createActor(10.5, 20.5, LEFT);
    for (let i = 0; i < 200; i += 1) advance(a, 0.1, (tx) => wallAt(8)(tx));
    expect(a.x).toBeCloseTo(9.5, 1e-9);
  });

  it('lets the player corner early but ghosts only at the centre', () => {
    // The asymmetry that makes the game survivable.
    const early = createActor(10.5 - 0.3, 20.5, RIGHT);
    early.nextDir = DOWN;
    expect(tryTurn(early, open, PLAYER_CORNER_TOLERANCE)).toBeTruthy();

    const strict = createActor(10.5 - 0.3, 20.5, RIGHT);
    strict.nextDir = DOWN;
    expect(tryTurn(strict, open, 0.06)).toBeFalsy();
  });

  it('always allows a reversal, however far from a centre', () => {
    const a = createActor(10.9, 20.5, RIGHT);
    a.nextDir = LEFT;
    expect(tryTurn(a, open, 0)).toBeTruthy();
    expect(a.dir).toBe(LEFT);
  });

  it('refuses a perpendicular turn into a wall', () => {
    const a = createActor(10.5, 20.5, RIGHT);
    a.nextDir = UP;
    expect(tryTurn(a, (x, y) => y !== 19, PLAYER_CORNER_TOLERANCE)).toBeFalsy();
    expect(a.dir).toBe(RIGHT);
  });
});

describe('fsm', () => {
  it('allows RESTART from MENU as well as GAME_OVER', () => {
    expect(transition(STATES.MENU, EVENTS.RESTART)).toBe(STATES.PLAYING);
    expect(transition(STATES.GAME_OVER, EVENTS.RESTART)).toBe(STATES.PLAYING);
  });

  it('throws on a state it has never heard of', () => {
    expect(() => transition('NOWHERE', EVENTS.START)).toThrow();
  });

  it('runs only in PLAYING', () => {
    expect(isRunning(STATES.PLAYING)).toBeTruthy();
    for (const s of [STATES.MENU, STATES.PAUSED, STATES.GAME_OVER]) {
      expect(isRunning(s)).toBeFalsy();
    }
  });
});

describe('the reducer', () => {
  it('starts in MENU with a full board and three lives', () => {
    const s = createGame({});
    expect(s.fsm).toBe(STATES.MENU);
    expect(s.pelletsLeft).toBe(TOTAL_DOTS + TOTAL_ENERGIZERS);
    expect(s.lives).toBe(START_LIVES);
    expect(s.score).toBe(0);
  });

  it('holds everything still during the Ready pause', () => {
    const s = playing();
    const x = s.player.x;
    run(s, 30, {});
    expect(s.player.x).toBeCloseTo(x, 1e-9);
  });

  it('eats dots and scores for them', () => {
    const s = playing();
    const events = typesOf(run(s, 60 * 4, { dir: LEFT }));
    expect(events.includes('dot')).toBeTruthy();
    expect(s.score).toBeGreaterThan(0);
    expect(s.pelletsLeft).toBeLessThan(TOTAL_DOTS + TOTAL_ENERGIZERS);
  });

  it('does not advance while paused', () => {
    const s = playing();
    run(s, 60 * 3, { dir: LEFT });
    applyAction(s, ACTIONS.PAUSE, []);
    const frozen = s.playTimeMs;
    step(s, FRAME, { dir: LEFT });
    expect(s.playTimeMs).toBe(frozen);
  });

  it('clears the level when the last pellet goes, and moves on', () => {
    const s = playing();
    // Empty the board rather than play it, so this tests the transition.
    s.pellets.fill(0);
    s.pelletsLeft = 0;
    // Ready pause (2s) plus the between-boards pause (1.8s) must both elapse.
    const cleared = typesOf(run(s, 60 * 6, {}));
    expect(cleared.includes('levelClear')).toBeTruthy();
    expect(cleared.includes('levelStart')).toBeTruthy();
    expect(s.level).toBe(2);
    // Refilled, not exact: the player is already moving on the new board by the
    // time these frames run out, so asserting a full 244 would be brittle for no
    // extra confidence. Coming back above TOTAL_DOTS from zero is the fact.
    expect(s.pelletsLeft).toBeGreaterThan(TOTAL_DOTS);
  });

  it('wins rather than looping past the last level', () => {
    const s = playing();
    s.level = MAX_LEVEL;
    s.pellets.fill(0);
    s.pelletsLeft = 0;
    let guard = 0;
    while (s.fsm === STATES.PLAYING && guard < 60 * 10) { step(s, FRAME, {}); guard += 1; }
    expect(s.fsm).toBe(STATES.GAME_OVER);
    expect(s.won).toBeTruthy();
  });

  it('awards one extra life at the documented score and never again', () => {
    const s = playing();
    s.score = EXTRA_LIFE_AT - 5;
    const events = typesOf(run(s, 60 * 5, { dir: LEFT }));
    expect(events.includes('extraLife')).toBeTruthy();
    expect(s.lives).toBe(START_LIVES + 1);

    s.score = EXTRA_LIFE_AT * 3;
    const again = typesOf(run(s, 60 * 3, { dir: LEFT }));
    expect(again.includes('extraLife')).toBeFalsy();
  });

  it('ends the run when the lives are gone', () => {
    const s = playing();
    s.lives = 1;
    let guard = 0;
    while (s.fsm === STATES.PLAYING && guard < 60 * 400) { step(s, FRAME, {}); guard += 1; }
    expect(s.fsm).toBe(STATES.GAME_OVER);
    expect(s.won).toBeFalsy();
  });

  it('shows a fruit once the dot threshold is passed', () => {
    const s = playing();
    s.dotsEaten = FRUIT_AT_DOTS[0] - 1;
    const events = typesOf(run(s, 60 * 6, { dir: LEFT }));
    expect(events.includes('fruitShown')).toBeTruthy();
  });

  it('is deterministic: identical input gives an identical run', () => {
    const a = playing();
    const b = playing();
    for (let i = 0; i < 60 * 20; i += 1) {
      step(a, FRAME, { dir: LEFT });
      step(b, FRAME, { dir: LEFT });
    }
    expect(a.score).toBe(b.score);
    expect(a.lives).toBe(b.lives);
    expect(a.player.x).toBeCloseTo(b.player.x, 1e-12);
  });

  it('keeps the modern-AI flag out of everything except targeting', () => {
    const arcade = createGame({ modernAI: false });
    const modern = createGame({ modernAI: true });
    expect(arcade.pelletsLeft).toBe(modern.pelletsLeft);
    expect(arcade.lives).toBe(modern.lives);
    expect(arcade.level).toBe(modern.level);
  });
});
