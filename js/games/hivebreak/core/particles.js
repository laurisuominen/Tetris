/**
 * Explosion particles. Pre-allocated, like everything else that spawns.
 *
 * These live in core/ rather than render/ for two reasons: CLAUDE.md forbids
 * state mutation inside render/, and a pool that advances on the fixed timestep
 * looks identical on a 60Hz and a 144Hz display, which one driven by the
 * render callback would not.
 */

import { MAX_PARTICLES, PARTICLE_LIFE_MS } from './constants.js';

export function createParticles() {
  const list = new Array(MAX_PARTICLES);
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    list[i] = { alive: false, x: 0, y: 0, vx: 0, vy: 0, lifeMs: 0, hue: 0 };
  }
  return list;
}

export function clearParticles(pool) {
  for (let i = 0; i < pool.length; i += 1) pool[i].alive = false;
}

/**
 * Scatters `count` particles from a point.
 *
 * Takes the RNG as an argument rather than calling Math.random, so a seeded run
 * is reproducible and the tests can assert on it.
 */
export function burst(pool, x, y, count, hue, rand) {
  let spawned = 0;
  for (let i = 0; i < pool.length && spawned < count; i += 1) {
    const p = pool[i];
    if (p.alive) continue;
    const angle = rand() * Math.PI * 2;
    const speed = 1.4 + rand() * 3.2;
    p.alive = true;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.lifeMs = PARTICLE_LIFE_MS;
    p.hue = hue;
    spawned += 1;
  }
  return spawned;
}

export function stepParticles(pool, dt) {
  const dragged = Math.pow(0.86, dt * 60);
  for (let i = 0; i < pool.length; i += 1) {
    const p = pool[i];
    if (!p.alive) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= dragged;
    p.vy *= dragged;
    p.lifeMs -= dt * 1000;
    if (p.lifeMs <= 0) p.alive = false;
  }
}
