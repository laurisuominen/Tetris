/**
 * Bullet pools — the player's and the enemies', same shape, opposite direction.
 *
 * Both are fixed-size arrays allocated once. Firing finds a free slot and
 * writes into it; a bullet that leaves the field just flips `alive`. Nothing
 * is created or destroyed during a run.
 *
 * A full pool means the shot simply does not happen, which for the player is
 * the two-bullet limit doing its job rather than an error.
 */

export function createBulletPool(size) {
  const list = new Array(size);
  for (let i = 0; i < size; i += 1) {
    list[i] = { alive: false, x: 0, y: 0, vy: 0 };
  }
  return list;
}

export function clearBullets(pool) {
  for (let i = 0; i < pool.length; i += 1) pool[i].alive = false;
}

export function countAlive(pool) {
  let n = 0;
  for (let i = 0; i < pool.length; i += 1) if (pool[i].alive) n += 1;
  return n;
}

/** @returns the bullet that was fired, or null if the pool was full. */
export function fireBullet(pool, x, y, vy, cap) {
  if (cap !== undefined && countAlive(pool) >= cap) return null;
  for (let i = 0; i < pool.length; i += 1) {
    const b = pool[i];
    if (b.alive) continue;
    b.alive = true;
    b.x = x;
    b.y = y;
    b.vy = vy;
    return b;
  }
  return null;
}

/** Advances every live bullet and retires the ones that left the field. */
export function stepBullets(pool, dt, topY, bottomY) {
  for (let i = 0; i < pool.length; i += 1) {
    const b = pool[i];
    if (!b.alive) continue;
    b.y += b.vy * dt;
    if (b.y < topY || b.y > bottomY) b.alive = false;
  }
}
