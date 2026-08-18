/**
 * The enemy pool and the per-enemy state machine.
 *
 * POOLING
 * -------
 * MAX_ENEMIES records are allocated once, in createEnemies, and reused for
 * every wave of every stage forever. `alive` is the only thing that makes one
 * real. Nothing here ever calls new, push, splice or object-literal — CLAUDE.md
 * is explicit that a GC pause costs frames, and this is the pool it names.
 *
 * THE STATE MACHINE
 * -----------------
 *   ENTERING      flying the opening path in from off-screen
 *   SEEKING       peeling off the entry path toward its own slot
 *   IN_FORMATION  parked, swaying with the block
 *   DIVING        flying a relative dive path; leaves the screen at the bottom
 *   RETURNING     wrapped to the top, flying back down into its slot
 *   BEAMING       a boss holding station with the tractor beam open
 *
 * ENTERING and RETURNING both end by handing over to SEEKING rather than by
 * snapping to the slot, because the formation is swaying: a slot's x at the
 * moment a path ends is not where it will be a frame later, and snapping shows
 * as a visible twitch.
 */

import { overlaps } from './collision.js';
import {
  MAX_ENEMIES, KIND, HITS_TO_KILL, ENEMY_HALF_W, ENEMY_HALF_H,
  ENTRY_SPEED, DIVE_SPEED, ROWS
} from './constants.js';
import {
  ENTRY_PATHS, DIVE_PATHS, CAPTURE_PATH, samplePath, headingAt
} from './paths.js';
import { slotX, slotY, kindOfSlot } from './formation.js';

export const ENEMY_STATE = Object.freeze({
  ENTERING: 'ENTERING',
  SEEKING: 'SEEKING',
  IN_FORMATION: 'IN_FORMATION',
  DIVING: 'DIVING',
  RETURNING: 'RETURNING',
  BEAMING: 'BEAMING'
});

/** Seconds to fly from the end of a path into the formation slot. */
const SEEK_S = 0.42;

/** Scratch shared by every enemy. Written and read within a single call. */
const _p = { x: 0, y: 0 };
const _a = { x: 0, y: 0 };
const _b = { x: 0, y: 0 };

/** One pool, allocated once. */
export function createEnemies() {
  const list = new Array(MAX_ENEMIES);
  for (let i = 0; i < MAX_ENEMIES; i += 1) {
    list[i] = {
      alive: false,
      kind: KIND.BEE,
      slot: 0,
      hits: 0,
      state: ENEMY_STATE.IN_FORMATION,
      x: 0,
      y: 0,
      angle: 0,

      /** Which baked path, and how far along it, in tiles. */
      path: null,
      dist: 0,
      /** Anchor for a RELATIVE path (dives). Zero for absolute entry paths. */
      originX: 0,
      originY: 0,
      /** Mirrors a relative path's x about its origin. */
      flip: false,

      /** SEEKING / RETURNING lerp. */
      seekT: 0,
      seekFromX: 0,
      seekFromY: 0,

      fireCooldownS: 0,
      /** A boss that has taken the player's ship. */
      hasCaptive: false,
      beamMs: 0
    };
  }
  return list;
}

/** Puts every enemy back in its slot for a fresh wave. */
export function resetWave(enemies, slots, entryKeys) {
  for (let i = 0; i < enemies.length; i += 1) enemies[i].alive = false;

  for (let i = 0; i < slots.length && i < enemies.length; i += 1) {
    const e = enemies[i];
    const slot = slots[i];
    e.alive = true;
    e.slot = slot;
    e.kind = kindOfSlot(slot);
    e.hits = 0;
    e.state = ENEMY_STATE.ENTERING;
    e.path = ENTRY_PATHS[entryKeys[i % entryKeys.length]];
    e.dist = -(i % 6) * 0.9;      // stagger so a wave streams in
    e.originX = 0;
    e.originY = 0;
    e.flip = false;
    e.seekT = 0;
    e.fireCooldownS = 0;
    e.hasCaptive = false;
    e.beamMs = 0;
    e.x = e.path.xs[0];
    e.y = e.path.ys[0];
    e.angle = 0;
  }
}

/** Sends an enemy out of formation along a dive path. */
export function startDive(enemy, pathKey, flip) {
  enemy.state = ENEMY_STATE.DIVING;
  enemy.path = DIVE_PATHS[pathKey];
  enemy.dist = 0;
  enemy.originX = enemy.x;
  enemy.originY = enemy.y;
  enemy.flip = !!flip;
  enemy.angle = 0;
}

/** Sends a boss down to hold station and open its beam. */
export function startCaptureRun(enemy) {
  enemy.state = ENEMY_STATE.BEAMING;
  enemy.path = CAPTURE_PATH;
  enemy.dist = 0;
  enemy.originX = enemy.x;
  enemy.originY = enemy.y;
  enemy.flip = false;
  enemy.beamMs = 0;
}

/** Begins the flight back into formation from the top of the screen. */
export function startReturn(enemy, offset) {
  enemy.state = ENEMY_STATE.RETURNING;
  enemy.seekT = 0;
  enemy.seekFromX = slotX(enemy.slot, offset);
  enemy.seekFromY = -1.5;
  enemy.x = enemy.seekFromX;
  enemy.y = enemy.seekFromY;
  enemy.angle = 0;
}

/** Applies a relative path sample to an enemy, honouring its flip. */
function placeOnRelativePath(enemy) {
  samplePath(enemy.path, enemy.dist, _p);
  enemy.x = enemy.originX + (enemy.flip ? -_p.x : _p.x);
  enemy.y = enemy.originY + _p.y;
  const heading = headingAt(enemy.path, enemy.dist, _a, _b);
  enemy.angle = enemy.flip ? -heading : heading;
}

/**
 * Advance one enemy by dt seconds.
 *
 * Returns a string describing what happened so the caller can react without
 * this module knowing about scoring, sound or events:
 *   'none'      nothing notable
 *   'reached'   arrived in its formation slot
 *   'escaped'   flew off the bottom and needs wrapping to the top
 *   'beamOpen'  a boss reached the beam row
 *   'beamDone'  the beam closed
 */
export function stepEnemy(enemy, dt, offset, speedFactor) {
  switch (enemy.state) {
    case ENEMY_STATE.ENTERING: {
      enemy.dist += ENTRY_SPEED * speedFactor * dt;
      if (enemy.dist >= enemy.path.length) {
        enemy.state = ENEMY_STATE.SEEKING;
        enemy.seekT = 0;
        enemy.seekFromX = enemy.x;
        enemy.seekFromY = enemy.y;
        return 'none';
      }
      samplePath(enemy.path, enemy.dist, _p);
      enemy.x = _p.x;
      enemy.y = _p.y;
      enemy.angle = headingAt(enemy.path, enemy.dist, _a, _b);
      return 'none';
    }

    case ENEMY_STATE.SEEKING:
    case ENEMY_STATE.RETURNING: {
      enemy.seekT += dt / SEEK_S;
      const targetX = slotX(enemy.slot, offset);
      const targetY = slotY(enemy.slot);
      if (enemy.seekT >= 1) {
        enemy.state = ENEMY_STATE.IN_FORMATION;
        enemy.x = targetX;
        enemy.y = targetY;
        enemy.angle = 0;
        return 'reached';
      }
      // Smoothstep, so arrival eases rather than stopping dead.
      const t = enemy.seekT * enemy.seekT * (3 - 2 * enemy.seekT);
      enemy.x = enemy.seekFromX + (targetX - enemy.seekFromX) * t;
      enemy.y = enemy.seekFromY + (targetY - enemy.seekFromY) * t;
      enemy.angle = 0;
      return 'none';
    }

    case ENEMY_STATE.IN_FORMATION: {
      enemy.x = slotX(enemy.slot, offset);
      enemy.y = slotY(enemy.slot);
      enemy.angle = 0;
      return 'none';
    }

    case ENEMY_STATE.DIVING: {
      enemy.dist += DIVE_SPEED * speedFactor * dt;
      placeOnRelativePath(enemy);
      if (enemy.y > ROWS + 1) return 'escaped';
      return 'none';
    }

    case ENEMY_STATE.BEAMING: {
      if (enemy.dist < enemy.path.length) {
        enemy.dist += DIVE_SPEED * speedFactor * dt;
        placeOnRelativePath(enemy);
        if (enemy.dist >= enemy.path.length) return 'beamOpen';
        return 'none';
      }
      enemy.beamMs += dt * 1000;
      enemy.angle = 0;
      return 'none';
    }

    default:
      return 'none';
  }
}

/** Whether a dead-on hit at (x, y) overlaps this enemy. */
export function hitsEnemy(enemy, x, y, halfW, halfH) {
  return overlaps(x, y, halfW, halfH, enemy.x, enemy.y, ENEMY_HALF_W, ENEMY_HALF_H);
}

/** True once the enemy has absorbed enough hits to die. */
export function isDead(enemy) {
  return enemy.hits >= HITS_TO_KILL[enemy.kind];
}

/**
 * Whether the enemy is flying a curve and should therefore be drawn banked
 * into it. Formation, seeking and beam-holding all draw upright.
 *
 * Used only by the renderer, but it lives here because it is a fact about the
 * state machine and would rot if a second copy existed in render/.
 */
export function followsPath(enemy) {
  return enemy.state === ENEMY_STATE.ENTERING
      || enemy.state === ENEMY_STATE.DIVING;
}

/** Diving enemies are worth more; see POINTS in constants.js. */
export function isDiving(enemy) {
  return enemy.state === ENEMY_STATE.DIVING
      || enemy.state === ENEMY_STATE.BEAMING;
}
