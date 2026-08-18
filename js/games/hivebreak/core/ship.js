/**
 * The player's ship.
 *
 * Movement is an AXIS, not a queue of discrete moves — same reasoning as
 * Breakout's paddle. A pointer target overrides the axis when present, which is
 * how drag-to-move works; arbitration between the two lives in main.js, not
 * here, because core must not know a pointer exists.
 *
 * The dual fighter is one ship with a wider hitbox and a second muzzle, not two
 * ship records. Two records would need their own collision, their own
 * respawn and their own capture rules, all of which would then be able to
 * disagree.
 */

import {
  COLS, SHIP_Y, SHIP_SPEED, SHIP_HALF_W, DUAL_OFFSET, FIRE_COOLDOWN_MS
} from './constants.js';

export function createShip() {
  return {
    x: COLS / 2,
    y: SHIP_Y,
    /** False while exploding or waiting to fly back in. */
    alive: true,
    /** Rescued a captive: wider, and fires two bullets a shot. */
    dual: false,
    /** Counts down after a death; the ship is absent while it runs. */
    respawnMs: 0,
    fireCooldownMs: 0
  };
}

export function resetShip(ship) {
  ship.x = COLS / 2;
  ship.y = SHIP_Y;
  ship.alive = true;
  ship.dual = false;
  ship.respawnMs = 0;
  ship.fireCooldownMs = 0;
}

/** Half-width of the ship's hitbox. A dual fighter is genuinely a bigger target. */
export function shipHalfWidth(ship) {
  return ship.dual ? SHIP_HALF_W + DUAL_OFFSET : SHIP_HALF_W;
}

/** Clamps so no part of the ship leaves the field. */
function clampX(ship, x) {
  const half = shipHalfWidth(ship);
  return Math.min(Math.max(x, half), COLS - half);
}

/** Held-key or on-screen-button steering. */
export function moveShip(ship, axis, dt) {
  if (!ship.alive || axis === 0) return;
  ship.x = clampX(ship, ship.x + axis * SHIP_SPEED * dt);
}

/**
 * Drag steering. Absolute, but rate-limited to SHIP_SPEED.
 *
 * The limit is what stops a drag from teleporting the ship across the field and
 * through a bullet on the way — and it keeps touch and keyboard equally fast,
 * so neither input is the cheat.
 */
export function steerShipTo(ship, targetX, dt) {
  if (!ship.alive) return;
  const max = SHIP_SPEED * dt;
  const delta = clampX(ship, targetX) - ship.x;
  if (Math.abs(delta) <= max) ship.x = clampX(ship, targetX);
  else ship.x += Math.sign(delta) * max;
}

/** Whether the gun is off cooldown. */
export function canFire(ship) {
  return ship.alive && ship.fireCooldownMs <= 0;
}

export function armCooldown(ship) {
  ship.fireCooldownMs = FIRE_COOLDOWN_MS;
}

/** Muzzle x positions. One barrel normally, two once a captive is rescued. */
export function muzzleOffsets(ship) {
  return ship.dual ? [-DUAL_OFFSET, DUAL_OFFSET] : [0];
}
