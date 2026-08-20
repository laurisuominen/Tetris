/**
 * The pure game reducer.
 *
 * `step(state, dt, input)` advances one fixed timestep and returns the next
 * state plus a list of EVENT DESCRIPTIONS — `{type:'kill', points, kind}`,
 * `{type:'captured'}`, `{type:'stageClear', stage}`. Core never plays a sound,
 * draws a pixel or touches the DOM. Render, audio, UI and storage subscribe to
 * that stream instead.
 *
 * State is mutated in place and returned, matching the other three games. Every
 * pool inside it — enemies, both bullet arrays, particles — is allocated once
 * in createGame and reused for the life of the tab.
 *
 * `input` is `{ actions, axis, pointer, firing }`:
 *   actions  discrete: PAUSE, RESUME, START, RESTART
 *   axis     -1 / 0 / +1, from held keys or the on-screen arrows
 *   pointer  absolute ship target in tile space, or null
 *   firing   whether the trigger is held (or auto-fire is on)
 *
 * Steering is an axis and firing is a boolean rather than queued actions, for
 * the reason Breakout's paddle is: draining discrete "move left" events at a
 * step boundary is the right shape for a Tetris piece and the wrong one for
 * something that moves continuously.
 */

import {
  COLS, ROWS, SHIP_Y, START_LIVES, MAX_STAGE, MAX_PLAYER_BULLETS,
  DUAL_BULLET_CAP, BULLET_SPEED, ENEMY_BULLET_SPEED, MAX_ENEMY_BULLETS,
  BULLET_HALF_W, BULLET_HALF_H, STAGE_CLEAR_MS, RESPAWN_MS,
  DIVE_INTERVAL_S, DIVE_INTERVAL_FLOOR_S, DIVE_INTERVAL_DECAY, MAX_DIVERS,
  SORTIE_SIZE,
  DIVE_FIRE_RATE, BEAM_INTERVAL_S, BEAM_DURATION_MS, BEAM_ROW_Y,
  SPEEDS, SPEED_FACTOR, KIND
} from './constants.js';
import { STATES, EVENTS, transition, acceptsGameplayInput, isRunning } from './fsm.js';
import { occupiedSlots, breatheOffset } from './formation.js';
import {
  createEnemies, resetWave, stepEnemy, startDive, startReturn, startCaptureRun,
  hitsEnemy, isDead, isDiving, ENEMY_STATE
} from './enemies.js';
import { ENTRY_ORDER, DIVE_ORDER } from './paths.js';
import {
  createBulletPool, clearBullets, fireBullet, stepBullets, countAlive
} from './bullets.js';
import {
  createShip, resetShip, moveShip, steerShipTo, shipHalfWidth,
  canFire, armCooldown, muzzleOffsets
} from './ship.js';
import { createParticles, clearParticles, burst, stepParticles } from './particles.js';
import { pointsFor, stageBonus, rescueBonus } from './scoring.js';
import { beamIsOpen, shipCaught, releasesCaptive, destroysCaptive } from './capture.js';
import { mulberry32 } from '../../../shared/util/rng.js';

export const ACTIONS = Object.freeze({
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  START: 'START',
  RESTART: 'RESTART'
});

/** Particles thrown by each kind of death. */
const BURST_ENEMY = 12;
const BURST_SHIP = 22;

/* -------------------------------------------------------------------------- */

export function createGame({ speed = SPEEDS.CLASSIC } = {}) {
  const state = {
    fsm: STATES.MENU,

    ship: createShip(),
    enemies: createEnemies(),
    playerBullets: createBulletPool(DUAL_BULLET_CAP),
    enemyBullets: createBulletPool(MAX_ENEMY_BULLETS),
    particles: createParticles(),

    speed,

    stage: 1,
    lives: START_LIVES,
    score: 0,
    won: false,

    /** Drives the formation's sway. Seconds since the run began. */
    elapsedS: 0,
    offset: 0,

    /** Counts down between stages, with the field frozen. */
    stageClearMs: 0,
    /** Seconds until the next sortie leaves the formation. */
    diveTimerS: DIVE_INTERVAL_S,
    /** Seconds until a boss next tries to take the ship. See BEAM_INTERVAL_S. */
    beamTimerS: BEAM_INTERVAL_S,

    /** Index of the boss holding the player's ship, or -1. */
    captiveHeldBy: -1,

    playTimeMs: 0,

    /** Seeded so a run is reproducible and the tests can assert on it. */
    rand: mulberry32(0x51ca9e),

    /** Scratch, allocated once. */
    _slots: occupiedSlots(),
    _diverPicks: new Int32Array(MAX_DIVERS)
  };

  resetRun(state);
  return state;
}

/** Rebuilds a run in place. Reuses every pool; allocates nothing. */
function resetRun(state) {
  state.stage = 1;
  state.lives = START_LIVES;
  state.score = 0;
  state.won = false;
  state.elapsedS = 0;
  state.offset = 0;
  state.stageClearMs = 0;
  state.captiveHeldBy = -1;
  state.playTimeMs = 0;
  state.rand = mulberry32(0x51ca9e);

  resetShip(state.ship);
  clearBullets(state.playerBullets);
  clearBullets(state.enemyBullets);
  clearParticles(state.particles);
  startStage(state, 1);
}

function startStage(state, stage) {
  state.stage = stage;
  state.diveTimerS = diveInterval(state);
  state.beamTimerS = BEAM_INTERVAL_S / SPEED_FACTOR[state.speed];
  resetWave(state.enemies, state._slots, ENTRY_ORDER);
}

/** Seconds between sorties, tightening with the stage and the difficulty tier. */
function diveInterval(state) {
  const decayed = DIVE_INTERVAL_S * (1 - DIVE_INTERVAL_DECAY * (state.stage - 1));
  const floored = Math.max(decayed, DIVE_INTERVAL_FLOOR_S);
  return floored / SPEED_FACTOR[state.speed];
}

const bulletCap = (ship) => (ship.dual ? DUAL_BULLET_CAP : MAX_PLAYER_BULLETS);

/* --- actions ---------------------------------------------------------------- */

export function applyAction(state, action, events) {
  switch (action) {
    case ACTIONS.START:
    case ACTIONS.RESTART: {
      state.fsm = transition(state.fsm, EVENTS.RESTART);
      resetRun(state);
      events.push({ type: 'start' });
      events.push({ type: 'stageStart', stage: state.stage });
      break;
    }
    case ACTIONS.PAUSE: {
      const next = transition(state.fsm, EVENTS.PAUSE);
      if (next !== state.fsm) {
        state.fsm = next;
        events.push({ type: 'pause', paused: next === STATES.PAUSED });
      }
      break;
    }
    case ACTIONS.RESUME: {
      const next = transition(state.fsm, EVENTS.RESUME);
      if (next !== state.fsm) {
        state.fsm = next;
        events.push({ type: 'pause', paused: false });
      }
      break;
    }
    default:
      break;
  }
}

export function configure(state, options = {}) {
  // The tier is a rule, applied on the next start rather than mid-run — same
  // contract as Breakout's speed setting.
  if (options.speed && SPEED_FACTOR[options.speed] !== undefined) {
    state.speed = options.speed;
  }
}

/* --- the step --------------------------------------------------------------- */

export function step(state, dtMs, input = {}) {
  const events = [];
  const actions = input.actions ?? [];
  for (let i = 0; i < actions.length; i += 1) applyAction(state, actions[i], events);

  if (!isRunning(state.fsm)) return { state, events };

  const dt = dtMs / 1000;
  state.playTimeMs += dtMs;
  state.elapsedS += dt;
  state.offset = breatheOffset(state.elapsedS);

  const factor = SPEED_FACTOR[state.speed];
  const { ship } = state;

  // Between stages the field is frozen but particles keep settling, so the
  // last explosion does not freeze mid-air.
  if (state.stageClearMs > 0) {
    state.stageClearMs -= dtMs;
    stepParticles(state.particles, dt);
    if (state.stageClearMs <= 0) advanceStage(state, events);
    return { state, events };
  }

  if (ship.respawnMs > 0) {
    ship.respawnMs -= dtMs;
    if (ship.respawnMs <= 0) {
      ship.alive = true;
      ship.x = COLS / 2;
      ship.fireCooldownMs = 0;
    }
  }

  if (acceptsGameplayInput(state.fsm)) {
    if (typeof input.pointer === 'number') steerShipTo(ship, input.pointer, dt);
    else moveShip(ship, input.axis ?? 0, dt);
  }

  if (ship.fireCooldownMs > 0) ship.fireCooldownMs -= dtMs;
  if (input.firing && canFire(ship)) tryFire(state, events);

  stepBullets(state.playerBullets, dt, -1, ROWS + 1);
  stepBullets(state.enemyBullets, dt, -1, ROWS + 1);
  stepParticles(state.particles, dt);

  stepEnemies(state, dt, factor, events);
  scheduleDives(state, dt, events);
  scheduleBeam(state, dt);

  resolvePlayerBullets(state, events);
  resolveThreatsToShip(state, events);

  if (waveCleared(state) && state.stageClearMs <= 0) {
    state.score += stageBonus();
    state.stageClearMs = STAGE_CLEAR_MS;
    events.push({ type: 'stageClear', stage: state.stage, score: state.score });
  }

  return { state, events };
}

function advanceStage(state, events) {
  if (state.stage >= MAX_STAGE) {
    state.won = true;
    state.fsm = transition(state.fsm, EVENTS.DIE);
    events.push({ type: 'gameOver', won: true, score: state.score });
    return;
  }
  startStage(state, state.stage + 1);
  events.push({ type: 'stageStart', stage: state.stage });
}

function stepEnemies(state, dt, factor, events) {
  const { enemies, ship } = state;
  for (let i = 0; i < enemies.length; i += 1) {
    const e = enemies[i];
    if (!e.alive) continue;

    const outcome = stepEnemy(e, dt, state.offset, factor);

    if (outcome === 'escaped') {
      startReturn(e, state.offset);
    } else if (outcome === 'beamOpen') {
      e.beamMs = 1;
      events.push({ type: 'beamOpen' });
    }

    // A boss holding station: catch the ship, then close up and go home.
    if (e.state === ENEMY_STATE.BEAMING && e.beamMs > 0) {
      if (shipCaught(e, ship) && state.captiveHeldBy === -1) {
        captureShip(state, i, events);
      }
      if (e.beamMs >= BEAM_DURATION_MS) {
        startDive(e, DIVE_ORDER[Math.floor(state.rand() * DIVE_ORDER.length)], false);
      }
    }

    // Divers shoot. Rate is per second, so it does not change with the timestep.
    if (isDiving(e) && ship.alive) {
      e.fireCooldownS -= dt;
      if (e.fireCooldownS <= 0 && state.rand() < DIVE_FIRE_RATE * dt * factor) {
        fireBullet(state.enemyBullets, e.x, e.y + 0.4, ENEMY_BULLET_SPEED);
        e.fireCooldownS = 0.35;
        events.push({ type: 'enemyShoot' });
      }
    }
  }
}

/** Sends a sortie out of the formation when the timer comes round. */
function scheduleDives(state, dt, events) {
  state.diveTimerS -= dt;
  if (state.diveTimerS > 0) return;
  state.diveTimerS = diveInterval(state);

  const { enemies } = state;

  // Count what is parked AND what is already out. The second number is the one
  // that matters: without it sorties stack, because the interval between them
  // is shorter than a dive takes to fly. See MAX_DIVERS.
  let parked = 0;
  let airborne = 0;
  for (let i = 0; i < enemies.length; i += 1) {
    const e = enemies[i];
    if (!e.alive) continue;
    if (e.state === ENEMY_STATE.IN_FORMATION) parked += 1;
    else if (isDiving(e)) airborne += 1;
  }
  if (parked === 0) return;

  const room = MAX_DIVERS - airborne;
  if (room <= 0) return;   // sky is full; the timer has already been reset

  const wanted = Math.min(1 + Math.floor(state.rand() * SORTIE_SIZE), room, parked);
  let sent = 0;

  for (let i = 0; i < enemies.length && sent < wanted; i += 1) {
    const e = enemies[i];
    if (!e.alive || e.state !== ENEMY_STATE.IN_FORMATION) continue;
    // Thin the field so a sortie is not always the same eight enemies.
    if (state.rand() > wanted / parked) continue;

    startDive(e, DIVE_ORDER[Math.floor(state.rand() * DIVE_ORDER.length)], state.rand() < 0.5);
    sent += 1;
  }

  if (sent > 0) events.push({ type: 'dive', count: sent });
}

/**
 * Sends a boss down to try for the ship, on its own clock.
 *
 * Silently does nothing when a captive is already held, when the ship is
 * already gone, or when every boss is dead — all three are ordinary, and none
 * should reset the timer to a full interval, so the attempt is retried on the
 * next tick rather than deferred another BEAM_INTERVAL_S.
 */
function scheduleBeam(state, dt) {
  state.beamTimerS -= dt;
  if (state.beamTimerS > 0) return;

  const { enemies, ship } = state;
  if (!ship.alive || state.captiveHeldBy !== -1) return;

  for (let i = 0; i < enemies.length; i += 1) {
    const e = enemies[i];
    if (!e.alive || e.kind !== KIND.BOSS) continue;
    if (e.state !== ENEMY_STATE.IN_FORMATION) continue;
    if (e.y >= BEAM_ROW_Y) continue;
    startCaptureRun(e);
    state.beamTimerS = BEAM_INTERVAL_S / SPEED_FACTOR[state.speed];
    return;
  }
}

function tryFire(state, events) {
  const { ship } = state;
  const cap = bulletCap(ship);
  if (countAlive(state.playerBullets) >= cap) return;

  const offsets = muzzleOffsets(ship);
  let fired = 0;
  for (let i = 0; i < offsets.length; i += 1) {
    const b = fireBullet(state.playerBullets, ship.x + offsets[i], ship.y - 0.4, -BULLET_SPEED, cap);
    if (b) fired += 1;
  }
  if (fired > 0) {
    armCooldown(ship);
    events.push({ type: 'shoot' });
  }
}

function resolvePlayerBullets(state, events) {
  const { playerBullets, enemies } = state;

  for (let bi = 0; bi < playerBullets.length; bi += 1) {
    const b = playerBullets[bi];
    if (!b.alive) continue;

    for (let ei = 0; ei < enemies.length; ei += 1) {
      const e = enemies[ei];
      if (!e.alive) continue;
      if (!hitsEnemy(e, b.x, b.y, BULLET_HALF_W, BULLET_HALF_H)) continue;

      b.alive = false;
      e.hits += 1;

      if (!isDead(e)) {
        // A boss that survived. Nothing but a colour change and a sound.
        events.push({ type: 'armour', kind: e.kind });
        break;
      }

      const points = pointsFor(e);
      state.score += points;
      burst(state.particles, e.x, e.y, BURST_ENEMY, 0, state.rand);
      events.push({ type: 'kill', points, kind: e.kind, diving: isDiving(e) });

      if (releasesCaptive(e)) {
        state.captiveHeldBy = -1;
        e.hasCaptive = false;
        state.ship.dual = true;
        state.score += rescueBonus();
        events.push({ type: 'rescued', bonus: rescueBonus() });
      } else if (destroysCaptive(e)) {
        state.captiveHeldBy = -1;
        e.hasCaptive = false;
        events.push({ type: 'captiveLost' });
      }

      e.alive = false;
      break;
    }
  }
}

/** Enemy bullets and enemies themselves, both of which kill the ship. */
function resolveThreatsToShip(state, events) {
  const { ship, enemyBullets, enemies } = state;
  if (!ship.alive) return;

  const halfW = shipHalfWidth(ship);

  for (let i = 0; i < enemyBullets.length; i += 1) {
    const b = enemyBullets[i];
    if (!b.alive) continue;
    if (Math.abs(b.x - ship.x) <= halfW + BULLET_HALF_W
        && Math.abs(b.y - ship.y) <= 0.36 + BULLET_HALF_H) {
      b.alive = false;
      killShip(state, events);
      return;
    }
  }

  for (let i = 0; i < enemies.length; i += 1) {
    const e = enemies[i];
    if (!e.alive || !isDiving(e)) continue;
    if (hitsEnemy(e, ship.x, ship.y, halfW, 0.36)) {
      e.alive = false;
      burst(state.particles, e.x, e.y, BURST_ENEMY, 0, state.rand);
      killShip(state, events);
      return;
    }
  }
}

function captureShip(state, bossIndex, events) {
  const { ship } = state;
  const boss = state.enemies[bossIndex];

  boss.hasCaptive = true;
  state.captiveHeldBy = bossIndex;

  ship.alive = false;
  ship.dual = false;
  ship.respawnMs = RESPAWN_MS;
  state.lives -= 1;

  events.push({ type: 'captured', lives: state.lives });
  endRunIfOut(state, events);
}

function killShip(state, events) {
  const { ship } = state;
  burst(state.particles, ship.x, ship.y, BURST_SHIP, 1, state.rand);

  ship.alive = false;
  ship.dual = false;
  ship.respawnMs = RESPAWN_MS;
  state.lives -= 1;

  events.push({ type: 'shipHit', lives: state.lives });
  endRunIfOut(state, events);
}

function endRunIfOut(state, events) {
  if (state.lives > 0) return;
  state.won = false;
  state.fsm = transition(state.fsm, EVENTS.DIE);
  events.push({ type: 'gameOver', won: false, score: state.score });
}

function waveCleared(state) {
  const { enemies } = state;
  for (let i = 0; i < enemies.length; i += 1) if (enemies[i].alive) return false;
  return true;
}

export { STATES, SHIP_Y, COLS, ROWS };
