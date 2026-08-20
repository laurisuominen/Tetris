/**
 * The pure game reducer.
 *
 * `step(state, dt, input)` advances one fixed timestep and returns the next
 * state plus a list of EVENT DESCRIPTIONS — `{type:'dot'}`, `{type:'ghostEaten',
 * points}`, `{type:'levelClear', level}`. Core never plays a sound, draws a pixel
 * or touches the DOM.
 *
 * State is mutated in place and returned, matching the other four games. Pools —
 * the ghost array and the pellet bytes — are allocated once and reused for the
 * life of the tab.
 *
 * `input` is `{ actions, dir }`:
 *   actions  discrete: PAUSE, RESUME, START, RESTART
 *   dir      the direction the player is asking for, or null
 *
 * A direction rather than a queue, and it is BUFFERED rather than applied: the
 * player presses before the junction and the turn happens at the first tile
 * where it is legal. Requiring frame-accurate input at a corner is the single
 * most common way a maze game is made unplayable.
 */

import {
  COLS, UP, DOWN, LEFT, RIGHT, GHOST, PLAYER_START, HOUSE_DOOR, START_LIVES,
  MAX_LEVEL, BASE_SPEED, PLAYER_CORNER_TOLERANCE, GHOST_TURN_TOLERANCE,
  EYES_SPEED, HOUSE_SPEED, ELROY_SPEED_BONUS, EXTRA_LIFE_AT,
  FRUIT_AT_DOTS, FRUIT_VISIBLE_MS, FRUIT_TILE, READY_MS, DEATH_PAUSE_MS,
  LEVEL_CLEAR_MS, SPEEDS, SPEED_TABLE
} from './constants.js';
import { STATES, EVENTS, transition, acceptsGameplayInput, isRunning } from './fsm.js';
import {
  createPellets, resetPellets, pelletAt, eatPellet, PELLET,
  isWalkable, isWalkableByPlayer, isTunnel
} from './maze.js';
import { createActor, tileOf, tryTurn, advance, wrapThroughTunnel } from './actor.js';
import {
  createGhosts, resetGhosts, stepHouse, stepPathing, forceReverse,
  GHOST_STATE, isInHouse, isEdible, isThreat
} from './ghosts.js';
import { targetTile, MODE, elroyIgnoresScatter } from './targeting.js';
import { createModeState, stepModes } from './modes.js';
import {
  createHouse, resetHouse, onDeath, onDotEaten, stepIdle, shouldRelease, noteRelease
} from './house.js';
import { speedsFor, frightFor, elroyFor, fruitFor } from './levels.js';
import { dotPoints, energizerPoints, ghostPoints, fruitPoints } from './scoring.js';
import { mulberry32 } from '../../../shared/util/rng.js';

export const ACTIONS = Object.freeze({
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  START: 'START',
  RESTART: 'RESTART'
});

/* -------------------------------------------------------------------------- */

export function createGame({ speed = SPEEDS.CLASSIC, modernAI = false } = {}) {
  const state = {
    fsm: STATES.MENU,

    player: createActor(PLAYER_START.x, PLAYER_START.y, LEFT),
    ghosts: createGhosts(),
    pellets: createPellets(),

    speed,
    /** Corrected ghost offsets. Never set for a leaderboard run — see main.js. */
    modernAI,

    level: 1,
    score: 0,
    lives: START_LIVES,
    won: false,
    extraLifeAwarded: false,

    pelletsLeft: 0,
    dotsEaten: 0,

    modes: createModeState(1),
    house: createHouse(1),

    /** Frightened countdown. Zero means nobody is blue. */
    frightMs: 0,
    frightTotalMs: 0,
    frightFlashes: 0,
    chainIndex: 0,

    fruit: { visible: false, msLeft: 0, points: 0, name: '', shownCount: 0 },

    /** The three pauses that are timers rather than states — see fsm.js. */
    readyMs: READY_MS,
    dyingMs: 0,
    levelClearMs: 0,

    elroyStage: 0,
    playTimeMs: 0,

    rand: mulberry32(0x9a71c3),

    /** Scratch, allocated once. */
    _target: { x: 0, y: 0 },
    _pac: { tileX: 0, tileY: 0, dir: LEFT },
    _self: { tileX: 0, tileY: 0 },
    _blinky: { tileX: 0, tileY: 0 }
  };

  resetRun(state);
  return state;
}

function resetRun(state) {
  state.level = SPEED_TABLE[state.speed]?.startLevel ?? 1;
  state.score = 0;
  state.lives = START_LIVES;
  state.won = false;
  state.extraLifeAwarded = false;
  state.playTimeMs = 0;
  state.rand = mulberry32(0x9a71c3);
  startLevel(state, state.level);
}

function startLevel(state, level) {
  state.level = level;
  state.pelletsLeft = resetPellets(state.pellets);
  state.dotsEaten = 0;
  state.modes = createModeState(level);
  resetHouse(state.house, level);
  state.frightMs = 0;
  state.chainIndex = 0;
  state.elroyStage = 0;
  state.fruit.visible = false;
  state.fruit.shownCount = 0;
  resetPositions(state);
  state.levelClearMs = 0;
}

/** Back to the start marks without touching the board. Used after a death too. */
function resetPositions(state) {
  const p = state.player;
  p.x = PLAYER_START.x;
  p.y = PLAYER_START.y;
  p.dir = LEFT;
  p.nextDir = LEFT;
  resetGhosts(state.ghosts);
  state.readyMs = READY_MS;
  state.dyingMs = 0;
  state.frightMs = 0;
  state.chainIndex = 0;
}

/* --- actions ---------------------------------------------------------------- */

export function applyAction(state, action, events) {
  switch (action) {
    case ACTIONS.START:
    case ACTIONS.RESTART:
      state.fsm = transition(state.fsm, EVENTS.RESTART);
      resetRun(state);
      events.push({ type: 'start' });
      events.push({ type: 'levelStart', level: state.level });
      break;
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
  if (options.speed && SPEED_TABLE[options.speed]) state.speed = options.speed;
  if (typeof options.modernAI === 'boolean') state.modernAI = options.modernAI;
}

/* --- the step --------------------------------------------------------------- */

export function step(state, dtMs, input = {}) {
  const events = [];
  const actions = input.actions ?? [];
  for (let i = 0; i < actions.length; i += 1) applyAction(state, actions[i], events);

  if (!isRunning(state.fsm)) return { state, events };

  state.playTimeMs += dtMs;

  // Buffer the request even during a pause — it should be honoured the instant
  // play resumes rather than dropped.
  if (typeof input.dir === 'number') state.player.nextDir = input.dir;

  if (state.levelClearMs > 0) {
    state.levelClearMs -= dtMs;
    if (state.levelClearMs <= 0) advanceLevel(state, events);
    return { state, events };
  }

  if (state.dyingMs > 0) {
    state.dyingMs -= dtMs;
    if (state.dyingMs <= 0) afterDeath(state, events);
    return { state, events };
  }

  if (state.readyMs > 0) {
    state.readyMs -= dtMs;
    return { state, events };
  }

  const dt = dtMs / 1000;
  const speeds = speedsFor(state.level);

  stepPlayer(state, dt, speeds, events);
  stepFright(state, dtMs, events);
  stepSchedule(state, dtMs);
  stepFruit(state, dtMs, events);
  stepGhosts(state, dt, speeds);
  resolveContacts(state, events);

  if (state.pelletsLeft === 0 && state.levelClearMs <= 0) {
    state.levelClearMs = LEVEL_CLEAR_MS;
    events.push({ type: 'levelClear', level: state.level, score: state.score });
  }

  return { state, events };
}

/* --- the player ------------------------------------------------------------- */

function stepPlayer(state, dt, speeds, events) {
  const p = state.player;
  if (!acceptsGameplayInput(state.fsm)) return;

  tryTurn(p, isWalkableByPlayer, PLAYER_CORNER_TOLERANCE);

  // Eating a dot SLOWS the player. This is the mechanism by which ghosts close
  // the gap, and a version without it plays nothing like the original.
  const onPellet = pelletAt(state.pellets, tileOf(p.x), tileOf(p.y)) !== PELLET.NONE;
  const pct = onPellet ? speeds.playerDots : speeds.player;

  advance(p, BASE_SPEED * pct * dt, isWalkableByPlayer);
  wrapThroughTunnel(p);

  eatHere(state, events);
}

function eatHere(state, events) {
  const p = state.player;
  const tx = tileOf(p.x);
  const ty = tileOf(p.y);
  const kind = eatPellet(state.pellets, tx, ty);
  if (kind === PELLET.NONE) {
    stepIdle(state.house, 1000 / 60);
    return;
  }

  state.pelletsLeft -= 1;
  state.dotsEaten += 1;
  onDotEaten(state.house, (g) => isInHouse(state.ghosts[g]));

  if (kind === PELLET.DOT) {
    addScore(state, dotPoints(), events);
    events.push({ type: 'dot' });
  } else {
    addScore(state, energizerPoints(), events);
    events.push({ type: 'energizer' });
    beginFright(state, events);
  }

  updateElroy(state, events);
  maybeShowFruit(state, events);
}

function addScore(state, points, events) {
  state.score += points;
  if (!state.extraLifeAwarded && state.score >= EXTRA_LIFE_AT) {
    state.extraLifeAwarded = true;
    state.lives += 1;
    events.push({ type: 'extraLife', lives: state.lives });
  }
}

/**
 * Cruise Elroy: Blinky speeds up and stops scattering once the board thins.
 * Two stages, both per-level thresholds on dots REMAINING.
 */
function updateElroy(state, events) {
  const { one, two } = elroyFor(state.level);
  const before = state.elroyStage;
  let stage = 0;
  if (state.pelletsLeft <= two) stage = 2;
  else if (state.pelletsLeft <= one) stage = 1;
  if (stage !== before) {
    state.elroyStage = stage;
    state.ghosts[GHOST.BLINKY].elroy = stage;
    if (stage > before) events.push({ type: 'elroy', stage });
  }
}

/* --- frightened ------------------------------------------------------------- */

function beginFright(state, events) {
  const { seconds, flashes } = frightFor(state.level);
  state.chainIndex = 0;

  // Even at zero seconds the ghosts still REVERSE. That is what makes the late
  // levels feel hostile rather than merely fast, and it is easy to lose.
  forceReverse(state.ghosts);

  if (seconds <= 0) {
    state.frightMs = 0;
    events.push({ type: 'frightNone' });
    return;
  }

  state.frightMs = seconds * 1000;
  state.frightTotalMs = state.frightMs;
  state.frightFlashes = flashes;
  for (const g of state.ghosts) {
    if (g.state === GHOST_STATE.OUT) g.state = GHOST_STATE.FRIGHTENED;
  }
  events.push({ type: 'fright', seconds });
}

function stepFright(state, dtMs, events) {
  if (state.frightMs <= 0) return;
  state.frightMs -= dtMs;
  if (state.frightMs > 0) return;

  state.frightMs = 0;
  state.chainIndex = 0;
  for (const g of state.ghosts) {
    if (g.state === GHOST_STATE.FRIGHTENED) g.state = GHOST_STATE.OUT;
  }
  events.push({ type: 'frightEnd' });
}

/** The scatter/chase clock is suspended while anything is blue. */
function stepSchedule(state, dtMs) {
  const changed = stepModes(state.modes, dtMs, state.frightMs > 0);
  if (changed) forceReverse(state.ghosts);
}

/* --- fruit ------------------------------------------------------------------ */

function maybeShowFruit(state, events) {
  const target = FRUIT_AT_DOTS[state.fruit.shownCount];
  if (target === undefined || state.dotsEaten < target) return;
  const { name, points } = fruitFor(state.level);
  state.fruit.visible = true;
  state.fruit.msLeft = FRUIT_VISIBLE_MS;
  state.fruit.points = points;
  state.fruit.name = name;
  state.fruit.shownCount += 1;
  events.push({ type: 'fruitShown', name, points });
}

function stepFruit(state, dtMs, events) {
  if (!state.fruit.visible) return;
  state.fruit.msLeft -= dtMs;
  if (state.fruit.msLeft <= 0) {
    state.fruit.visible = false;
    events.push({ type: 'fruitGone' });
    return;
  }
  const p = state.player;
  if (tileOf(p.x) === FRUIT_TILE.x && tileOf(p.y) === Math.floor(FRUIT_TILE.y)) {
    state.fruit.visible = false;
    addScore(state, state.fruit.points, events);
    events.push({ type: 'fruitEaten', points: state.fruit.points, name: state.fruit.name });
  }
}

/* --- ghosts ----------------------------------------------------------------- */

function ghostSpeed(state, ghost, speeds) {
  switch (ghost.state) {
    case GHOST_STATE.HOUSE:
    case GHOST_STATE.LEAVING:
    case GHOST_STATE.ENTERING:
      return BASE_SPEED * HOUSE_SPEED;
    case GHOST_STATE.EYES:
      return BASE_SPEED * EYES_SPEED;
    case GHOST_STATE.FRIGHTENED:
      return BASE_SPEED * speeds.fright;
    default: {
      const tunnel = isTunnel(tileOf(ghost.x), tileOf(ghost.y));
      const base = tunnel ? speeds.tunnel : speeds.ghost;
      const elroy = ghost.id === GHOST.BLINKY && ghost.elroy > 0
        ? ELROY_SPEED_BONUS[ghost.elroy - 1] : 0;
      return BASE_SPEED * (base + elroy);
    }
  }
}

function stepGhosts(state, dt, speeds) {
  const p = state.player;
  state._pac.tileX = tileOf(p.x);
  state._pac.tileY = tileOf(p.y);
  state._pac.dir = p.dir;

  const blinky = state.ghosts[GHOST.BLINKY];
  state._blinky.tileX = tileOf(blinky.x);
  state._blinky.tileY = tileOf(blinky.y);

  for (const g of state.ghosts) {
    const distance = ghostSpeed(state, g, speeds) * dt;

    if (g.state === GHOST_STATE.HOUSE) {
      if (shouldRelease(state.house, g.id, (id) => isInHouse(state.ghosts[id]))) {
        g.state = GHOST_STATE.LEAVING;
        noteRelease(state.house);
      } else {
        stepHouse(g, distance);
        continue;
      }
    }

    if (g.state === GHOST_STATE.LEAVING) {
      if (stepHouse(g, distance)) {
        g.state = GHOST_STATE.OUT;
        g.dir = LEFT;
        g.decidedTile = -1;
        // A ghost leaving while the board is frightened joins in blue.
        if (state.frightMs > 0) g.state = GHOST_STATE.FRIGHTENED;
      }
      continue;
    }

    if (g.state === GHOST_STATE.ENTERING) {
      if (stepHouse(g, distance)) g.state = GHOST_STATE.HOUSE;
      continue;
    }

    if (g.state === GHOST_STATE.EYES) {
      steerEyesHome(g, distance);
      continue;
    }

    state._self.tileX = tileOf(g.x);
    state._self.tileY = tileOf(g.y);

    const frightened = g.state === GHOST_STATE.FRIGHTENED;
    let mode = state.modes.mode;
    // Elroy Blinky never scatters — he keeps hunting through the whole phase.
    if (elroyIgnoresScatter(g.id, g.elroy)) mode = MODE.CHASE;

    const target = frightened
      ? state._target
      : targetTile(g.id, mode, state._pac, state._self, state._blinky, state.modernAI);

    stepPathing(g, distance, target, isWalkable, frightened, state.rand);
  }
}

/**
 * Eaten ghosts travel back as eyes. Deliberately NOT the normal pathing: eyes
 * pass through the door, which nothing else may do, and they take the direct
 * route rather than the legal one.
 */
function steerEyesHome(ghost, distance) {
  const dx = HOUSE_DOOR.x - ghost.x;
  const dy = HOUSE_DOOR.y - ghost.y;
  if (Math.abs(dx) > 0.05) {
    ghost.x += Math.sign(dx) * Math.min(distance, Math.abs(dx));
    ghost.dir = dx > 0 ? RIGHT : LEFT;
    return;
  }
  ghost.x = HOUSE_DOOR.x;
  if (Math.abs(dy) > 0.05) {
    ghost.y += Math.sign(dy) * Math.min(distance, Math.abs(dy));
    ghost.dir = dy > 0 ? DOWN : UP;
    return;
  }
  ghost.state = GHOST_STATE.ENTERING;
}

/* --- contact ---------------------------------------------------------------- */

function resolveContacts(state, events) {
  const p = state.player;
  const px = tileOf(p.x);
  const py = tileOf(p.y);

  for (const g of state.ghosts) {
    if (tileOf(g.x) !== px || tileOf(g.y) !== py) continue;

    if (isEdible(g)) {
      const points = ghostPoints(state.chainIndex);
      state.chainIndex += 1;
      addScore(state, points, events);
      g.state = GHOST_STATE.EYES;
      g.decidedTile = -1;
      events.push({ type: 'ghostEaten', points, ghost: g.id });
      continue;
    }

    if (isThreat(g)) {
      killPlayer(state, events);
      return;
    }
  }
}

function killPlayer(state, events) {
  state.lives -= 1;
  state.dyingMs = DEATH_PAUSE_MS;
  onDeath(state.house);
  events.push({ type: 'died', lives: state.lives });
}

function afterDeath(state, events) {
  if (state.lives <= 0) {
    state.won = false;
    state.fsm = transition(state.fsm, EVENTS.DIE);
    events.push({ type: 'gameOver', won: false, score: state.score });
    return;
  }
  resetPositions(state);
}

function advanceLevel(state, events) {
  if (state.level >= MAX_LEVEL) {
    state.won = true;
    state.fsm = transition(state.fsm, EVENTS.DIE);
    events.push({ type: 'gameOver', won: true, score: state.score });
    return;
  }
  startLevel(state, state.level + 1);
  events.push({ type: 'levelStart', level: state.level });
}

export { STATES };
