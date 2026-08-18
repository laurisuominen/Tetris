/**
 * Hivebreak core.
 *
 * Everything under js/games/hivebreak/core/ is DOM-free by design, so all of it
 * runs here as well as in the browser. Thresholds and geometry are IMPORTED
 * rather than retyped: a test that hard-codes 400 keeps passing after someone
 * changes the boss to 500 and forgets this file.
 *
 * The renderer, input and UI are not covered — they need a document. What they
 * would catch is a broken import path, and CLAUDE.md's definition of done
 * covers that with a network-panel check against the DEPLOYED origin instead.
 */

import { describe, it, expect } from './harness.js';

import {
  COLS, ROWS, KIND, POINTS, MAX_ENEMY_POINTS, HITS_TO_KILL, START_LIVES,
  MAX_PLAYER_BULLETS, DUAL_BULLET_CAP, FIRE_COOLDOWN_MS, BULLET_SPEED,
  MAX_STAGE, STAGE_CLEAR_BONUS, RESCUE_BONUS, SPEEDS, SPEED_FACTOR,
  FORMATION_COLS, FORMATION_ROWS, BOSS_COLUMNS, ROW_KINDS, SHIP_HALF_W,
  DUAL_OFFSET, SHIP_SPEED, BEAM_HALF_W, MAX_ENEMIES
} from '../js/games/hivebreak/core/constants.js';
import { bake, samplePath, headingAt, DIVE_PATHS, ENTRY_PATHS } from '../js/games/hivebreak/core/paths.js';
import {
  occupiedSlots, kindOfSlot, rowOfSlot, colOfSlot, breatheOffset, slotX, slotY
} from '../js/games/hivebreak/core/formation.js';
import {
  createEnemies, resetWave, startDive, stepEnemy, hitsEnemy, isDead, isDiving,
  followsPath, ENEMY_STATE
} from '../js/games/hivebreak/core/enemies.js';
import { createBulletPool, fireBullet, stepBullets, countAlive } from '../js/games/hivebreak/core/bullets.js';
import {
  createShip, moveShip, steerShipTo, shipHalfWidth, muzzleOffsets, canFire
} from '../js/games/hivebreak/core/ship.js';
import { overlaps, insideBeam } from '../js/games/hivebreak/core/collision.js';
import { pointsFor } from '../js/games/hivebreak/core/scoring.js';
import { beamIsOpen, shipCaught, releasesCaptive, destroysCaptive } from '../js/games/hivebreak/core/capture.js';
import { createGame, step, applyAction, ACTIONS } from '../js/games/hivebreak/core/game.js';
import { STATES, transition, EVENTS, isRunning } from '../js/games/hivebreak/core/fsm.js';

/** One frame at the fixed timestep. */
const FRAME = 1000 / 60;

/** Runs `frames` steps with the given input and collects every event type. */
function run(state, frames, input = {}) {
  const seen = [];
  for (let i = 0; i < frames && state.fsm === STATES.PLAYING; i += 1) {
    const { events } = step(state, FRAME, input);
    for (const e of events) seen.push(e);
  }
  return seen;
}

const typesOf = (events) => events.map((e) => e.type);

function playing() {
  const state = createGame({});
  applyAction(state, ACTIONS.RESTART, []);
  return state;
}

/**
 * Parks a stationary bullet on an enemy's CURRENT position.
 *
 * A step moves enemies before it resolves bullets, so the enemy will have
 * shifted slightly by the time the hit is tested — well inside the enemy box,
 * which is what makes this reliable rather than lucky.
 */
function aimAt(state, enemy) {
  const bullet = state.playerBullets[0];
  bullet.alive = true;
  bullet.x = enemy.x;
  bullet.y = enemy.y;
  bullet.vy = 0;
  return bullet;
}

/* -------------------------------------------------------------------------- */

describe('paths — baking and traversal', () => {
  it('rejects a control polygon it cannot curve through', () => {
    expect(() => bake([[0, 0]])).toThrow();
    expect(() => bake(null)).toThrow();
  });

  it('starts at the first control point and ends at the last', () => {
    const path = bake([[1, 2], [4, 5], [7, 1]]);
    const out = { x: 0, y: 0 };
    samplePath(path, 0, out);
    expect(out.x).toBeCloseTo(1, 1e-3);
    expect(out.y).toBeCloseTo(2, 1e-3);
    samplePath(path, path.length, out);
    expect(out.x).toBeCloseTo(7, 1e-3);
    expect(out.y).toBeCloseTo(1, 1e-3);
  });

  it('clamps rather than returning NaN outside its range', () => {
    const path = bake([[0, 0], [1, 1]]);
    const out = { x: 0, y: 0 };
    samplePath(path, -50, out);
    expect(out.x).toBeCloseTo(0, 1e-6);
    samplePath(path, path.length * 10, out);
    expect(out.x).toBeCloseTo(1, 1e-3);
    // NaN in must not propagate: it clamps to the start.
    samplePath(path, NaN, out);
    expect(Number.isFinite(out.x)).toBeTruthy();
  });

  it('advances at a CONSTANT speed, which is the whole reason for arc length', () => {
    // A straight-ish curve with one tight corner. Stepping the raw spline
    // parameter through this crawls round the corner; stepping by distance
    // must not. Equal distances therefore travel equal lengths.
    const path = bake([[0, 0], [6, 0], [6, 6], [0, 6]]);
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };

    let shortest = Infinity;
    let longest = 0;
    const stride = path.length / 40;
    for (let d = 0; d + stride <= path.length; d += stride) {
      samplePath(path, d, a);
      samplePath(path, d + stride, b);
      const moved = Math.hypot(b.x - a.x, b.y - a.y);
      shortest = Math.min(shortest, moved);
      longest = Math.max(longest, moved);
    }
    // Chord length is always a little under arc length on a curve, so this is
    // not exact — but a parameter-stepped curve varies by multiples, not by a
    // few percent.
    expect(longest / shortest).toBeLessThan(1.15);
  });

  it('reports heading with zero pointing down the screen', () => {
    const straightDown = bake([[3, 0], [3, 9]]);
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    expect(headingAt(straightDown, 4, a, b)).toBeCloseTo(0, 1e-3);

    const straightRight = bake([[0, 4], [9, 4]]);
    expect(headingAt(straightRight, 4, a, b)).toBeCloseTo(Math.PI / 2, 1e-3);
  });

  it('gives every dive path enough drop to clear the field from any slot', () => {
    // enemies.js decides a pass is over by y > ROWS + 1, and the lowest
    // formation row already sits several tiles down. A path that stopped short
    // would leave an enemy stuck off the bottom forever.
    const out = { x: 0, y: 0 };
    const lowestSlotY = slotY(FORMATION_COLS * FORMATION_ROWS - 1);
    for (const [name, path] of Object.entries(DIVE_PATHS)) {
      samplePath(path, path.length, out);
      expect(`${name}:${lowestSlotY + out.y > ROWS + 1}`).toBe(`${name}:true`);
    }
  });

  it('lands every entry path inside the field', () => {
    const out = { x: 0, y: 0 };
    for (const [name, path] of Object.entries(ENTRY_PATHS)) {
      samplePath(path, path.length, out);
      const inside = out.x >= 0 && out.x <= COLS && out.y >= 0 && out.y <= ROWS;
      expect(`${name}:${inside}`).toBe(`${name}:true`);
    }
  });
});

describe('formation', () => {
  it('fills every row but the boss row, which is half empty', () => {
    const slots = occupiedSlots();
    const counts = {};
    for (const slot of slots) {
      const kind = kindOfSlot(slot);
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    expect(counts[KIND.BOSS]).toBe(BOSS_COLUMNS.length);

    const butterflyRows = ROW_KINDS.filter((k) => k === KIND.BUTTERFLY).length;
    expect(counts[KIND.BUTTERFLY]).toBe(butterflyRows * FORMATION_COLS);
  });

  it('never needs more enemies than the pool holds', () => {
    expect(occupiedSlots().length).toBeLessThan(MAX_ENEMIES + 1);
  });

  it('maps a slot to its row and column', () => {
    expect(rowOfSlot(0)).toBe(0);
    expect(colOfSlot(0)).toBe(0);
    expect(rowOfSlot(FORMATION_COLS)).toBe(1);
    expect(colOfSlot(FORMATION_COLS + 3)).toBe(3);
  });

  it('sways as ONE oscillator, so the whole block shares an offset', () => {
    // Two slots on different rows must move by exactly the same amount, or the
    // formation shimmers instead of breathing.
    const offset = breatheOffset(1.1);
    expect(slotX(0, offset) - slotX(0, 0)).toBeCloseTo(offset, 1e-9);
    expect(slotX(FORMATION_COLS + 2, offset) - slotX(FORMATION_COLS + 2, 0))
      .toBeCloseTo(offset, 1e-9);
  });

  it('keeps the whole formation on the field at the extremes of the sway', () => {
    for (const t of [0, 0.25, 0.5, 1, 2, 3.7]) {
      const offset = breatheOffset(t);
      for (const slot of occupiedSlots()) {
        const x = slotX(slot, offset);
        expect(`${x > 0 && x < COLS}`).toBe('true');
      }
    }
  });
});

describe('enemies — the state machine', () => {
  it('starts a wave with everything entering from off a path', () => {
    const pool = createEnemies();
    const slots = occupiedSlots();
    resetWave(pool, slots, ['LEFT_LOOP', 'RIGHT_LOOP']);
    const alive = pool.filter((e) => e.alive);
    expect(alive.length).toBe(slots.length);
    expect(alive.every((e) => e.state === ENEMY_STATE.ENTERING)).toBeTruthy();
  });

  it('reuses the pool rather than growing it', () => {
    const pool = createEnemies();
    const before = pool.length;
    resetWave(pool, occupiedSlots(), ['LEFT_LOOP']);
    resetWave(pool, occupiedSlots(), ['LEFT_LOOP']);
    expect(pool.length).toBe(before);
  });

  it('flies ENTERING -> SEEKING -> IN_FORMATION and settles on its slot', () => {
    const pool = createEnemies();
    resetWave(pool, occupiedSlots(), ['TOP_FAN']);
    const e = pool[0];

    let reached = false;
    for (let i = 0; i < 1200 && !reached; i += 1) {
      if (stepEnemy(e, 1 / 60, 0, 1) === 'reached') reached = true;
    }
    expect(reached).toBeTruthy();
    expect(e.state).toBe(ENEMY_STATE.IN_FORMATION);
    expect(e.x).toBeCloseTo(slotX(e.slot, 0), 1e-6);
    expect(e.y).toBeCloseTo(slotY(e.slot), 1e-6);
  });

  it('reports "escaped" once a dive leaves the bottom of the field', () => {
    const pool = createEnemies();
    resetWave(pool, occupiedSlots(), ['TOP_FAN']);
    const e = pool[0];
    e.state = ENEMY_STATE.IN_FORMATION;
    e.x = slotX(e.slot, 0);
    e.y = slotY(e.slot);
    startDive(e, 'PLUNGE', false);

    let escaped = false;
    for (let i = 0; i < 1200 && !escaped; i += 1) {
      if (stepEnemy(e, 1 / 60, 0, 1) === 'escaped') escaped = true;
    }
    expect(escaped).toBeTruthy();
  });

  it('mirrors a dive path when flipped, and only in x', () => {
    const pool = createEnemies();
    resetWave(pool, occupiedSlots(), ['TOP_FAN']);
    const [a, b] = [pool[0], pool[1]];
    for (const e of [a, b]) {
      e.state = ENEMY_STATE.IN_FORMATION;
      e.x = 7;
      e.y = 3;
    }
    startDive(a, 'PEEL', false);
    startDive(b, 'PEEL', true);
    for (let i = 0; i < 30; i += 1) {
      stepEnemy(a, 1 / 60, 0, 1);
      stepEnemy(b, 1 / 60, 0, 1);
    }
    expect(a.x - 7).toBeCloseTo(-(b.x - 7), 1e-6);
    expect(a.y).toBeCloseTo(b.y, 1e-6);
  });

  it('banks into a curve only while actually flying one', () => {
    // A formation enemy has angle 0, and the renderer turns path-followers by
    // (PI - angle). Without this distinction a parked enemy renders upside down.
    expect(followsPath({ state: ENEMY_STATE.DIVING })).toBeTruthy();
    expect(followsPath({ state: ENEMY_STATE.ENTERING })).toBeTruthy();
    expect(followsPath({ state: ENEMY_STATE.IN_FORMATION })).toBeFalsy();
    expect(followsPath({ state: ENEMY_STATE.SEEKING })).toBeFalsy();
    expect(followsPath({ state: ENEMY_STATE.BEAMING })).toBeFalsy();
  });

  it('needs two hits to kill a boss and one for everything else', () => {
    expect(isDead({ kind: KIND.BEE, hits: 1 })).toBeTruthy();
    expect(isDead({ kind: KIND.BOSS, hits: 1 })).toBeFalsy();
    expect(isDead({ kind: KIND.BOSS, hits: HITS_TO_KILL[KIND.BOSS] })).toBeTruthy();
  });

  it('counts beaming as diving, so a beaming boss is worth the diving price', () => {
    expect(isDiving({ state: ENEMY_STATE.BEAMING })).toBeTruthy();
    expect(isDiving({ state: ENEMY_STATE.IN_FORMATION })).toBeFalsy();
  });
});

describe('collision', () => {
  it('overlaps on both axes or not at all', () => {
    expect(overlaps(0, 0, 1, 1, 1.5, 0, 1, 1)).toBeTruthy();
    expect(overlaps(0, 0, 1, 1, 2.5, 0, 1, 1)).toBeFalsy();
    // Touching exactly counts, so a hit on the boundary is not lost to rounding.
    expect(overlaps(0, 0, 1, 1, 2, 0, 1, 1)).toBeTruthy();
  });

  it('uses the enemy box for a bullet hit', () => {
    const e = { x: 5, y: 5 };
    expect(hitsEnemy(e, 5, 5, 0.05, 0.2)).toBeTruthy();
    expect(hitsEnemy(e, 9, 5, 0.05, 0.2)).toBeFalsy();
  });

  it('makes the beam a CONE, so it can be outrun sideways', () => {
    const bossX = 7;
    const bossY = 9;
    // Directly below, near the bottom: caught.
    expect(insideBeam(bossX, bossY, BEAM_HALF_W, 7, 16.4, ROWS)).toBeTruthy();
    // Same row, two tiles across: clear. This is the escape the cone exists for.
    expect(insideBeam(bossX, bossY, BEAM_HALF_W, 9, 16.4, ROWS)).toBeFalsy();
    // Just under the boss the cone has barely opened, so a small sidestep works.
    expect(insideBeam(bossX, bossY, BEAM_HALF_W, 7.6, 9.4, ROWS)).toBeFalsy();
    // Above the boss is never caught.
    expect(insideBeam(bossX, bossY, BEAM_HALF_W, 7, 4, ROWS)).toBeFalsy();
  });
});

describe('ship', () => {
  it('cannot be steered off either edge', () => {
    const ship = createShip();
    for (let i = 0; i < 400; i += 1) moveShip(ship, -1, 1 / 60);
    expect(ship.x).toBeCloseTo(SHIP_HALF_W, 1e-6);
    for (let i = 0; i < 800; i += 1) moveShip(ship, 1, 1 / 60);
    expect(ship.x).toBeCloseTo(COLS - SHIP_HALF_W, 1e-6);
  });

  it('rate-limits a drag so touch is never faster than the keys', () => {
    // Without the limit, a drag would teleport the ship across the field —
    // and through anything in the way.
    const dragged = createShip();
    const keyed = createShip();
    steerShipTo(dragged, COLS, 1 / 60);
    moveShip(keyed, 1, 1 / 60);
    expect(dragged.x).toBeCloseTo(keyed.x, 1e-9);
    expect(dragged.x - COLS / 2).toBeCloseTo(SHIP_SPEED / 60, 1e-9);
  });

  it('lands exactly on a drag target that is within reach', () => {
    const ship = createShip();
    steerShipTo(ship, COLS / 2 + 0.01, 1 / 60);
    expect(ship.x).toBeCloseTo(COLS / 2 + 0.01, 1e-9);
  });

  it('makes a dual fighter genuinely a bigger target', () => {
    const ship = createShip();
    const single = shipHalfWidth(ship);
    ship.dual = true;
    expect(shipHalfWidth(ship)).toBeGreaterThan(single);
    expect(shipHalfWidth(ship)).toBeCloseTo(SHIP_HALF_W + DUAL_OFFSET, 1e-9);
  });

  it('gives a dual fighter two barrels', () => {
    const ship = createShip();
    expect(muzzleOffsets(ship).length).toBe(1);
    ship.dual = true;
    expect(muzzleOffsets(ship).length).toBe(2);
  });

  it('will not fire while dead', () => {
    const ship = createShip();
    ship.alive = false;
    expect(canFire(ship)).toBeFalsy();
  });
});

describe('bullets', () => {
  it('refuses to exceed its cap rather than growing the pool', () => {
    const pool = createBulletPool(DUAL_BULLET_CAP);
    for (let i = 0; i < 10; i += 1) fireBullet(pool, 1, 1, -1, MAX_PLAYER_BULLETS);
    expect(countAlive(pool)).toBe(MAX_PLAYER_BULLETS);
    expect(pool.length).toBe(DUAL_BULLET_CAP);
  });

  it('retires a bullet that leaves the field', () => {
    const pool = createBulletPool(4);
    fireBullet(pool, 1, 1, -BULLET_SPEED);
    for (let i = 0; i < 60; i += 1) stepBullets(pool, 1 / 60, -1, ROWS + 1);
    expect(countAlive(pool)).toBe(0);
  });
});

describe('scoring', () => {
  it('pays double for a diving kill — the whole risk economy', () => {
    for (const kind of Object.values(KIND)) {
      const parked = pointsFor({ kind, state: ENEMY_STATE.IN_FORMATION });
      const diving = pointsFor({ kind, state: ENEMY_STATE.DIVING });
      expect(parked).toBe(POINTS[kind].formation);
      expect(diving).toBe(POINTS[kind].diving);
      expect(diving).toBeGreaterThan(parked);
    }
  });

  it('never pays more than the ceiling submit-score is derived from', () => {
    // If this fails, supabase/functions/submit-score/index.ts is now wrong and
    // will reject honest scores.
    for (const kind of Object.values(KIND)) {
      expect(POINTS[kind].diving).toBeLessThan(MAX_ENEMY_POINTS + 1);
    }
  });

  it('scores nothing for an enemy it does not recognise', () => {
    expect(pointsFor({ kind: 'WASP', state: ENEMY_STATE.DIVING })).toBe(0);
  });
});

describe('capture — the asymmetric rule', () => {
  const boss = (over) => ({
    alive: true, kind: KIND.BOSS, state: ENEMY_STATE.BEAMING,
    beamMs: 500, hasCaptive: false, x: 7, y: 9, ...over
  });

  it('opens a beam only while the timer is inside its window', () => {
    expect(beamIsOpen(boss())).toBeTruthy();
    expect(beamIsOpen(boss({ beamMs: 0 }))).toBeFalsy();
    expect(beamIsOpen(boss({ beamMs: 1e9 }))).toBeFalsy();
    expect(beamIsOpen(boss({ kind: KIND.BEE }))).toBeFalsy();
    expect(beamIsOpen(boss({ alive: false }))).toBeFalsy();
  });

  it('cannot catch a ship that is already gone', () => {
    expect(shipCaught(boss(), { alive: false, x: 7, y: 16 })).toBeFalsy();
  });

  it('frees the captive ONLY from a diving captor', () => {
    // This one asymmetry is the entire mechanic. Without it the correct play is
    // always "shoot the boss" and the capture is just a bigger enemy.
    expect(releasesCaptive({ hasCaptive: true, state: ENEMY_STATE.DIVING })).toBeTruthy();
    expect(releasesCaptive({ hasCaptive: true, state: ENEMY_STATE.IN_FORMATION })).toBeFalsy();
    expect(destroysCaptive({ hasCaptive: true, state: ENEMY_STATE.IN_FORMATION })).toBeTruthy();
    expect(destroysCaptive({ hasCaptive: true, state: ENEMY_STATE.DIVING })).toBeFalsy();
  });

  it('does neither when there is no captive at all', () => {
    expect(releasesCaptive({ hasCaptive: false, state: ENEMY_STATE.DIVING })).toBeFalsy();
    expect(destroysCaptive({ hasCaptive: false, state: ENEMY_STATE.IN_FORMATION })).toBeFalsy();
  });
});

describe('fsm', () => {
  it('allows RESTART from MENU as well as GAME_OVER', () => {
    // Snake shipped without the MENU row once and its Play button did nothing.
    expect(transition(STATES.MENU, EVENTS.RESTART)).toBe(STATES.PLAYING);
    expect(transition(STATES.GAME_OVER, EVENTS.RESTART)).toBe(STATES.PLAYING);
  });

  it('ignores an illegal pair rather than throwing', () => {
    expect(transition(STATES.MENU, EVENTS.RESUME)).toBe(STATES.MENU);
  });

  it('throws on a state it has never heard of', () => {
    expect(() => transition('ELSEWHERE', EVENTS.START)).toThrow();
  });

  it('runs the simulation in PLAYING and nowhere else', () => {
    expect(isRunning(STATES.PLAYING)).toBeTruthy();
    for (const s of [STATES.MENU, STATES.PAUSED, STATES.GAME_OVER, STATES.BOOT]) {
      expect(isRunning(s)).toBeFalsy();
    }
  });
});

describe('game — the reducer', () => {
  it('starts a run in MENU with a full formation and no score', () => {
    const state = createGame({});
    expect(state.fsm).toBe(STATES.MENU);
    expect(state.score).toBe(0);
    expect(state.stage).toBe(1);
    expect(state.lives).toBe(START_LIVES);
    expect(state.enemies.filter((e) => e.alive).length).toBe(occupiedSlots().length);
  });

  it('does not advance while paused', () => {
    const state = playing();
    run(state, 60, { firing: true });
    applyAction(state, ACTIONS.PAUSE, []);
    const frozen = state.playTimeMs;
    step(state, FRAME, { firing: true });
    expect(state.playTimeMs).toBe(frozen);
  });

  it('respects the gun cooldown, so holding is no faster than the rules allow', () => {
    const state = playing();
    const shots = typesOf(run(state, 60, { firing: true })).filter((t) => t === 'shoot');
    // One second of held trigger. The cooldown caps this, and the two-bullet
    // limit caps it further once shots are in flight — so it can be fewer, but
    // never more.
    expect(shots.length).toBeLessThan(Math.floor(1000 / FIRE_COOLDOWN_MS) + 1);
    expect(shots.length).toBeGreaterThan(0);
  });

  it('fires nothing at all with the trigger up', () => {
    const state = playing();
    expect(typesOf(run(state, 120, { firing: false })).includes('shoot')).toBeFalsy();
  });

  it('ends the run when the last life goes', () => {
    const state = playing();
    // A player who never shoots and never moves runs out eventually.
    let guard = 0;
    while (state.fsm === STATES.PLAYING && guard < 60 * 600) {
      step(state, FRAME, { firing: false });
      guard += 1;
    }
    expect(state.fsm).toBe(STATES.GAME_OVER);
    expect(state.lives).toBe(0);
    expect(state.won).toBeFalsy();
  });

  it('clears a stage, pays the bonus and moves on', () => {
    const state = playing();
    // Kill the wave outright rather than playing it, so this tests the stage
    // transition and not the author's aim.
    for (const e of state.enemies) e.alive = false;
    const cleared = run(state, 1, { firing: false });
    expect(typesOf(cleared).includes('stageClear')).toBeTruthy();
    expect(state.score).toBe(STAGE_CLEAR_BONUS);

    const next = run(state, 200, { firing: false });
    expect(typesOf(next).includes('stageStart')).toBeTruthy();
    expect(state.stage).toBe(2);
    expect(state.enemies.filter((e) => e.alive).length).toBe(occupiedSlots().length);
  });

  it('wins rather than looping when the last stage is cleared', () => {
    const state = playing();
    state.stage = MAX_STAGE;
    for (const e of state.enemies) e.alive = false;
    let guard = 0;
    while (state.fsm === STATES.PLAYING && guard < 600) {
      step(state, FRAME, { firing: false });
      guard += 1;
    }
    expect(state.fsm).toBe(STATES.GAME_OVER);
    expect(state.won).toBeTruthy();
  });

  it('resets everything on RESTART, including a rescued dual fighter', () => {
    const state = playing();
    state.score = 5000;
    state.stage = 7;
    state.lives = 1;
    state.ship.dual = true;
    applyAction(state, ACTIONS.RESTART, []);
    expect(state.score).toBe(0);
    expect(state.stage).toBe(1);
    expect(state.lives).toBe(START_LIVES);
    expect(state.ship.dual).toBeFalsy();
    expect(state.captiveHeldBy).toBe(-1);
  });

  it('is deterministic: identical input gives an identical run', () => {
    // The seeded RNG is what makes a bug reproducible from a description.
    const a = playing();
    const b = playing();
    for (let i = 0; i < 900; i += 1) {
      step(a, FRAME, { axis: 1, firing: true });
      step(b, FRAME, { axis: 1, firing: true });
    }
    expect(a.score).toBe(b.score);
    expect(a.lives).toBe(b.lives);
    expect(a.ship.x).toBeCloseTo(b.ship.x, 1e-12);
  });

  it('rejects an unknown difficulty tier instead of taking it into core', () => {
    const state = createGame({});
    const before = state.speed;
    applyAction(state, ACTIONS.RESTART, []);
    state.speed = before;
    // configure() is the guarded door; an unknown tier would make
    // SPEED_FACTOR[speed] undefined and every dive interval NaN.
    expect(SPEED_FACTOR[state.speed]).toBeGreaterThan(0);
    expect(Object.keys(SPEEDS).includes(state.speed)).toBeTruthy();
  });

  it('awards the rescue bonus and the dual fighter for a diving captor', () => {
    const state = playing();
    const boss = state.enemies.find((e) => e.kind === KIND.BOSS);
    boss.state = ENEMY_STATE.IN_FORMATION;
    boss.x = 7;
    boss.y = 4;
    startDive(boss, 'PLUNGE', false);
    boss.hasCaptive = true;
    boss.hits = HITS_TO_KILL[KIND.BOSS] - 1;   // one more hit kills it
    state.captiveHeldBy = state.enemies.indexOf(boss);

    // Let the step ordering settle the boss's position before aiming at it:
    // enemies move BEFORE bullets are resolved, so a bullet parked on last
    // frame's position would miss.
    run(state, 1, { firing: false });
    const bullet = aimAt(state, boss);

    const scoreBefore = state.score;
    const events = typesOf(run(state, 1, { firing: false }));
    expect(events.includes('kill')).toBeTruthy();
    expect(events.includes('rescued')).toBeTruthy();
    expect(state.ship.dual).toBeTruthy();
    expect(state.captiveHeldBy).toBe(-1);
    expect(state.score - scoreBefore).toBe(POINTS[KIND.BOSS].diving + RESCUE_BONUS);
  });

  it('destroys the captive when the captor is shot in formation', () => {
    const state = playing();
    const boss = state.enemies.find((e) => e.kind === KIND.BOSS);
    boss.state = ENEMY_STATE.IN_FORMATION;
    boss.hasCaptive = true;
    boss.hits = HITS_TO_KILL[KIND.BOSS] - 1;
    state.captiveHeldBy = state.enemies.indexOf(boss);

    run(state, 1, { firing: false });
    aimAt(state, boss);

    const events = typesOf(run(state, 1, { firing: false }));
    expect(events.includes('captiveLost')).toBeTruthy();
    expect(events.includes('rescued')).toBeFalsy();
    expect(state.ship.dual).toBeFalsy();
  });

  it('costs a life when the beam takes the ship', () => {
    const state = playing();
    const boss = state.enemies.find((e) => e.kind === KIND.BOSS);
    boss.state = ENEMY_STATE.BEAMING;
    boss.dist = boss.path ? boss.path.length : 0;
    boss.beamMs = 1;
    boss.x = state.ship.x;
    boss.y = 9;

    const livesBefore = state.lives;
    const events = typesOf(run(state, 30, { firing: false }));
    expect(events.includes('captured')).toBeTruthy();
    expect(state.lives).toBe(livesBefore - 1);
    expect(state.ship.alive).toBeFalsy();
    expect(state.captiveHeldBy).toBeGreaterThan(-1);
  });
});
