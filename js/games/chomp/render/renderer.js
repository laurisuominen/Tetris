/**
 * Draws the board. Reads state, never writes it.
 *
 * TWO LAYERS. The walls never change, so they live in their own canvas painted
 * once per resize; everything that moves is drawn on top each frame. Breakout
 * splits the same way and for the same reason.
 *
 * NO SPRITES, unlike Hivebreak — and that is a considered choice rather than
 * laziness. Hivebreak's ships and insects are detailed shapes that pixel art
 * flatters. A circle with a wedge cut out of it and a dome with a wavy hem are
 * shapes canvas paths render BETTER than a 12x12 grid can, at any size, with no
 * baking step and no second copy of the baker. If a future game needs real pixel
 * art, Hivebreak's render/sprites.js is the thing to promote to shared — it
 * would then have two callers, which is the bar CLAUDE.md sets.
 */

import { sizeCanvas, getDpr, watchDpr } from '../../../shared/render/dpr.js';
import { fitPlayfield, toScreenY } from './geometry.js';
import {
  COLS, MAZE_TOP, MAZE_BOTTOM, MAZE_ROWS, DIRS, GHOST, FRUIT_TILE
} from '../core/constants.js';
import { pelletAt, PELLET } from '../core/maze.js';
import { GHOST_STATE } from '../core/ghosts.js';
import { drawMaze } from './mazeLayer.js';

/** Flash rate for a frightened ghost about to turn solid again. */
const FLASH_MS = 220;

export function createRenderer({ container, wallCanvas, playCanvas, palette }) {
  if (!container || !wallCanvas || !playCanvas) {
    throw new Error('createRenderer requires a container and both canvases');
  }

  let wallCtx = null;
  let ctx = null;
  let cell = 0;
  let width = 0;
  let height = 0;
  let dpr = getDpr();
  let wallsDirty = true;

  function resize() {
    const rect = container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    dpr = getDpr();
    const fit = fitPlayfield(rect.width, rect.height, dpr);
    cell = fit.cell;
    width = fit.width;
    height = fit.height;

    for (const canvas of [wallCanvas, playCanvas]) {
      canvas.style.position = 'absolute';
      canvas.style.left = '50%';
      canvas.style.top = '50%';
      canvas.style.transform = 'translate(-50%, -50%)';
      canvas.style.width = `${fit.width}px`;
      canvas.style.height = `${fit.height}px`;
    }

    wallCtx = sizeCanvas(wallCanvas, fit.width, fit.height, dpr);
    ctx = sizeCanvas(playCanvas, fit.width, fit.height, dpr);

    // Assigning width/height cleared both layers.
    wallsDirty = true;
    document.documentElement.style.setProperty('--cell-size', `${cell}px`);
  }

  let pending = 0;
  function scheduleResize() {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; resize(); });
  }

  const observer = new ResizeObserver(scheduleResize);
  observer.observe(container);
  const stopDprWatch = watchDpr(scheduleResize);
  resize();

  /* --- helpers ------------------------------------------------------------- */

  const px = (tiles) => tiles * cell;
  const screenX = (simX) => px(simX);
  const screenY = (simY) => px(toScreenY(simY));

  function drawPellets(state) {
    const dotR = Math.max(cell * 0.09, 1);
    const bigR = Math.max(cell * 0.26, 2);

    ctx.fillStyle = palette.dot;
    ctx.beginPath();
    for (let y = MAZE_TOP; y <= MAZE_BOTTOM; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (pelletAt(state.pellets, x, y) !== PELLET.DOT) continue;
        const cx = screenX(x + 0.5);
        const cy = screenY(y + 0.5);
        ctx.moveTo(cx + dotR, cy);
        ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
      }
    }
    ctx.fill();

    // Energizers pulse, which is what makes them findable in peripheral vision.
    const pulse = 0.75 + 0.25 * Math.sin(state.playTimeMs / 140);
    ctx.fillStyle = palette.energizer;
    ctx.beginPath();
    for (let y = MAZE_TOP; y <= MAZE_BOTTOM; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (pelletAt(state.pellets, x, y) !== PELLET.ENERGIZER) continue;
        const cx = screenX(x + 0.5);
        const cy = screenY(y + 0.5);
        ctx.moveTo(cx + bigR * pulse, cy);
        ctx.arc(cx, cy, bigR * pulse, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  /**
   * The player: a circle with a wedge removed, opening toward travel.
   *
   * The mouth angle is driven by DISTANCE TRAVELLED rather than by wall time, so
   * the chomp slows when the player slows — which happens constantly, because
   * eating dots costs speed.
   */
  function drawPlayer(state) {
    const p = state.player;
    if (state.dyingMs > 0) return drawDeath(state);

    const travelled = (p.x + p.y) * 2;
    const open = Math.abs(Math.sin(travelled)) * 0.72;
    const facing = Math.atan2(DIRS[p.dir].dy, DIRS[p.dir].dx);
    const r = cell * 0.46;

    ctx.fillStyle = palette.player;
    ctx.beginPath();
    ctx.moveTo(screenX(p.x), screenY(p.y));
    ctx.arc(screenX(p.x), screenY(p.y), r, facing + open, facing - open + Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }

  /** The death animation: the wedge widens until nothing is left. */
  function drawDeath(state) {
    const p = state.player;
    const t = 1 - Math.max(state.dyingMs, 0) / 1600;
    const open = Math.min(t * Math.PI, Math.PI);
    const facing = -Math.PI / 2;
    const r = cell * 0.46;
    if (open >= Math.PI) return;

    ctx.fillStyle = palette.player;
    ctx.beginPath();
    ctx.moveTo(screenX(p.x), screenY(p.y));
    ctx.arc(screenX(p.x), screenY(p.y), r, facing + open, facing - open + Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }

  function ghostBodyColor(state, ghost) {
    if (ghost.state === GHOST_STATE.EYES || ghost.state === GHOST_STATE.ENTERING) return null;
    if (ghost.state !== GHOST_STATE.FRIGHTENED) return palette.ghost(ghost.id);

    // Flash white near the end, but only for the documented number of flashes.
    const remaining = state.frightMs;
    const flashWindow = state.frightFlashes * FLASH_MS * 2;
    if (remaining < flashWindow && Math.floor(remaining / FLASH_MS) % 2 === 0) {
      return palette.frightLit;
    }
    return palette.fright;
  }

  /** A dome with a wavy hem, plus eyes that look the way it is going. */
  function drawGhost(state, ghost) {
    const cx = screenX(ghost.x);
    const cy = screenY(ghost.y);
    const r = cell * 0.46;
    const body = ghostBodyColor(state, ghost);

    if (body) {
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.1, r, Math.PI, 0);
      ctx.lineTo(cx + r, cy + r * 0.75);
      // Three scallops along the bottom, animated so the ghost looks alive.
      const wob = Math.sin(state.playTimeMs / 90) * r * 0.12;
      ctx.lineTo(cx + r * 0.33, cy + r * 0.55 + wob);
      ctx.lineTo(cx, cy + r * 0.8 - wob);
      ctx.lineTo(cx - r * 0.33, cy + r * 0.55 + wob);
      ctx.lineTo(cx - r, cy + r * 0.75);
      ctx.closePath();
      ctx.fill();
    }

    // Eyes. A frightened ghost has none — that is what makes it read as prey.
    if (ghost.state === GHOST_STATE.FRIGHTENED) {
      ctx.fillStyle = palette.frightLit;
      ctx.beginPath();
      ctx.arc(cx - r * 0.3, cy - r * 0.15, r * 0.13, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.3, cy - r * 0.15, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const d = DIRS[ghost.dir];
    const ex = d.dx * r * 0.18;
    const ey = d.dy * r * 0.18;

    ctx.fillStyle = palette.eyes;
    ctx.beginPath();
    ctx.arc(cx - r * 0.3, cy - r * 0.2, r * 0.26, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.3, cy - r * 0.2, r * 0.26, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = palette.pupil;
    ctx.beginPath();
    ctx.arc(cx - r * 0.3 + ex, cy - r * 0.2 + ey, r * 0.13, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.3 + ex, cy - r * 0.2 + ey, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFruit(state) {
    if (!state.fruit.visible) return;
    const cx = screenX(FRUIT_TILE.x + 0.5);
    const cy = screenY(FRUIT_TILE.y);
    const r = cell * 0.34;
    ctx.fillStyle = palette.ghost(GHOST.BLINKY);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = palette.dot;
    ctx.lineWidth = Math.max(cell * 0.07, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.5, cy - r * 1.5);
    ctx.stroke();
  }

  function render(state) {
    if (!ctx) return;

    if (wallsDirty) {
      drawMaze(wallCtx, cell, palette);
      wallsDirty = false;
    }

    ctx.clearRect(0, 0, width, height);
    drawPellets(state);
    drawFruit(state);
    drawPlayer(state);
    for (const g of state.ghosts) drawGhost(state, g);
  }

  return {
    render,
    resize,
    invalidateWalls() { wallsDirty = true; },
    refresh() {
      palette.refresh();
      wallsDirty = true;
    },
    get cell() { return cell; },
    destroy() {
      observer.disconnect();
      stopDprWatch();
      if (pending) cancelAnimationFrame(pending);
    }
  };
}
