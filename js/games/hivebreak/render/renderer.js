/**
 * Draws the playfield. Reads state, never writes it.
 *
 * ONE canvas, unlike Breakout's two. Breakout splits the static brick wall off
 * so it can be repainted only when it changes; nothing here is static — the
 * formation sways every single frame — so a second layer would be a cache that
 * always misses.
 *
 * NO INTERPOLATION, and that is a real limitation rather than an oversight.
 * The loop hands render an `alpha` and this ignores it, so on a 120Hz display
 * motion still updates at the 60Hz simulation rate. Interpolating would mean
 * every enemy carrying a previous position through core, and the honest trade
 * was to keep core small. If motion looks stepped on a high-refresh display,
 * this comment is where to start, not the tuning.
 *
 * Sprite rotation: enemy.angle is atan2(dx, dy), so 0 means travelling straight
 * DOWN the screen. The art is drawn nose-up, so pointing a sprite along its
 * travel is a rotation of (PI - angle). Only path-following enemies are turned
 * — see followsPath — because a formation enemy with angle 0 would otherwise
 * render upside down.
 */

import { sizeCanvas, getDpr, watchDpr } from '../../../shared/render/dpr.js';
import { fitPlayfield } from './geometry.js';
import { COLS, ROWS, KIND, HITS_TO_KILL, BEAM_HALF_W, DUAL_OFFSET } from '../core/constants.js';
import { followsPath } from '../core/enemies.js';
import { beamIsOpen, beamProgress } from '../core/capture.js';

/** Which sprite a live enemy uses right now. */
function spriteFor(enemy) {
  if (enemy.kind === KIND.BOSS) {
    return enemy.hits > 0 && enemy.hits < HITS_TO_KILL[KIND.BOSS] ? 'BOSS_HIT' : 'BOSS';
  }
  return enemy.kind === KIND.BUTTERFLY ? 'BUTTERFLY' : 'BEE';
}

export function createRenderer({ container, canvas, palette, sprites }) {
  if (!container || !canvas) throw new Error('createRenderer requires a container and a canvas');

  let ctx = null;
  let cell = 0;
  let width = 0;
  let height = 0;
  let dpr = getDpr();

  function resize() {
    const rect = container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    dpr = getDpr();
    const fit = fitPlayfield(rect.width, rect.height, dpr);
    cell = fit.cell;
    width = fit.width;
    height = fit.height;

    canvas.style.position = 'absolute';
    canvas.style.left = '50%';
    canvas.style.top = '50%';
    canvas.style.transform = 'translate(-50%, -50%)';
    canvas.style.width = `${fit.width}px`;
    canvas.style.height = `${fit.height}px`;

    ctx = sizeCanvas(canvas, fit.width, fit.height, dpr);

    // Bake at the size sprites are actually drawn, in DEVICE pixels, so
    // drawImage never resamples. cell * dpr is a whole number by construction —
    // that is what fitGrid's snapping is for.
    sprites.bake(cell * dpr);

    document.documentElement.style.setProperty('--cell-size', `${cell}px`);
  }

  /* Coalesce bursts of resize callbacks into one repaint. */
  let pending = 0;
  function scheduleResize() {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      resize();
    });
  }

  const observer = new ResizeObserver(scheduleResize);
  observer.observe(container);
  const stopDprWatch = watchDpr(scheduleResize);

  resize();

  /* --- drawing ------------------------------------------------------------- */

  const px = (tiles) => tiles * cell;

  function drawSprite(name, cx, cy, angle) {
    const img = sprites.get(name);
    if (!img) return;
    const size = cell;
    const x = px(cx) - size / 2;
    const y = px(cy) - size / 2;

    if (!angle) {
      ctx.drawImage(img, x, y, size, size);
      return;
    }
    ctx.save();
    ctx.translate(px(cx), px(cy));
    ctx.rotate(angle);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  function drawBeams(state) {
    const { enemies } = state;
    for (let i = 0; i < enemies.length; i += 1) {
      const e = enemies[i];
      if (!beamIsOpen(e)) continue;

      // Widens as it opens, so the threat is legible before it is lethal.
      const t = Math.min(beamProgress(e) * 3, 1);
      const halfW = px(BEAM_HALF_W * t);
      const topY = px(e.y);
      const bottomY = px(ROWS);

      const gradient = ctx.createLinearGradient(0, topY, 0, bottomY);
      gradient.addColorStop(0, palette.beam);
      gradient.addColorStop(1, 'transparent');

      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(px(e.x), topY);
      ctx.lineTo(px(e.x) + halfW, bottomY);
      ctx.lineTo(px(e.x) - halfW, bottomY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawEnemies(state) {
    const { enemies } = state;
    for (let i = 0; i < enemies.length; i += 1) {
      const e = enemies[i];
      if (!e.alive) continue;

      const angle = followsPath(e) ? Math.PI - e.angle : 0;
      drawSprite(spriteFor(e), e.x, e.y, angle);

      // A captured fighter rides just below its captor.
      if (e.hasCaptive) drawSprite('SHIP', e.x, e.y + 1, Math.PI);
    }
  }

  function drawShip(state) {
    const { ship } = state;
    if (!ship.alive) return;
    if (ship.dual) {
      drawSprite('SHIP', ship.x - DUAL_OFFSET, ship.y, 0);
      drawSprite('SHIP', ship.x + DUAL_OFFSET, ship.y, 0);
      return;
    }
    drawSprite('SHIP', ship.x, ship.y, 0);
  }

  function drawBullets(pool, color, halfW, halfH) {
    ctx.fillStyle = color;
    for (let i = 0; i < pool.length; i += 1) {
      const b = pool[i];
      if (!b.alive) continue;
      ctx.fillRect(px(b.x - halfW), px(b.y - halfH), px(halfW * 2), px(halfH * 2));
    }
  }

  function drawParticles(state) {
    const { particles } = state;
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      if (!p.alive) continue;
      const life = Math.max(p.lifeMs, 0) / 520;
      ctx.globalAlpha = life;
      ctx.fillStyle = p.hue === 1 ? palette.shot : palette.enemyShot;
      const s = px(0.12) * life;
      ctx.fillRect(px(p.x) - s / 2, px(p.y) - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  function render(state) {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    drawBeams(state);
    drawEnemies(state);
    drawShip(state);
    drawBullets(state.playerBullets, palette.shot, 0.05, 0.2);
    drawBullets(state.enemyBullets, palette.enemyShot, 0.07, 0.16);
    drawParticles(state);
  }

  return {
    render,
    resize,
    /** After a theme change: colours are baked into the sprites. */
    refresh() {
      palette.refresh();
      sprites.invalidate();
    },
    get cell() { return cell; },
    destroy() {
      observer.disconnect();
      stopDprWatch();
      if (pending) cancelAnimationFrame(pending);
    }
  };
}
