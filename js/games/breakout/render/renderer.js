/**
 * Canvas renderer.
 *
 * Two stacked layers with very different redraw rates:
 *
 *   bricks  the wall            redrawn only when it changes or on resize
 *   play    ball, paddle, trail redrawn every frame
 *
 * Splitting them is not premature: 112 rounded rectangles is the bulk of the
 * drawing in this game and almost none of it changes between frames. The wall
 * is repainted when a brick breaks, when a level starts, and on resize —
 * main.js calls invalidateBricks() from the event stream, the same way Tetris
 * invalidates its board layer.
 *
 * INTERPOLATION — the opposite case to Snake's, and worth being explicit about.
 *
 * Snake advances in discrete jumps several frames apart, so it needs progress
 * through the MOVE: (moveTimerMs + alpha * TIMESTEP_MS) / moveIntervalMs.
 * Breakout's ball moves every single step, so createLoop's `alpha` is already
 * exactly the right quantity.
 *
 * It is used to interpolate BETWEEN the previous and current positions, not to
 * extrapolate past the current one. Extrapolating (x + vx * alpha * dt) would
 * push the ball visually through a wall or a brick for a frame at a time,
 * because nothing has resolved a collision at that position yet. Lerping
 * backwards costs one step of latency — 16.7ms — and can never draw the ball
 * somewhere the simulation says it cannot be.
 *
 * The one case lerping gets wrong is a step containing a bounce, where the
 * straight line from previous to current cuts the corner. Core flags those
 * with collidedThisStep and the renderer snaps to the resolved position.
 */

import {
  BALL_RADIUS, BRICK_W, BRICK_H, BRICK_COLS, BRICK_ROWS,
  PADDLE_Y, PADDLE_H, brickIndex
} from '../core/constants.js';
import { isRunning } from '../core/fsm.js';
import { brickLeft, brickTop, pointsOf, isAlive } from '../core/bricks.js';
import { sizeCanvas, getDpr, watchDpr } from '../../../shared/render/dpr.js';
import { fitPlayfield } from './geometry.js';
import { pathRoundedRect, drawRect, drawBall } from './blocks.js';

/** Gap between neighbouring bricks, as a fraction of a cell. */
const BRICK_GAP = 0.08;

/** How many past ball positions the trail remembers. */
const TRAIL_LENGTH = 8;

export function createRenderer({ container, bricksCanvas, playCanvas, palette }) {
  let cell = 20;
  let dpr = getDpr();
  let ctxBricks = null;
  let ctxPlay = null;
  let width = 0;
  let height = 0;
  let bricksDirty = true;

  // Pre-allocated ring buffer for the trail. Allocating an array of points per
  // frame is exactly the per-frame garbage CLAUDE.md rules out.
  const trailX = new Float32Array(TRAIL_LENGTH);
  const trailY = new Float32Array(TRAIL_LENGTH);
  let trailHead = 0;
  let trailCount = 0;

  /* --- sizing ------------------------------------------------------------- */

  function resize() {
    const rect = container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    dpr = getDpr();
    const fit = fitPlayfield(rect.width, rect.height, dpr);
    cell = fit.cell;
    width = fit.width;
    height = fit.height;

    for (const canvas of [bricksCanvas, playCanvas]) {
      canvas.style.position = 'absolute';
      canvas.style.left = '50%';
      canvas.style.top = '50%';
      canvas.style.transform = 'translate(-50%, -50%)';

      // Pin the CSS box to the fitted size. Leaving the stylesheet's
      // width/height:100% in charge stretches the element to the whole stack,
      // which is not exactly the fitted aspect once the slab's padding is
      // counted — the wall would be drawn at the snapped size and then scaled
      // by a few percent, undoing the device-pixel snapping fitPlayfield
      // exists to provide.
      canvas.style.width = `${fit.width}px`;
      canvas.style.height = `${fit.height}px`;
    }

    ctxBricks = sizeCanvas(bricksCanvas, fit.width, fit.height, dpr);
    ctxPlay = sizeCanvas(playCanvas, fit.width, fit.height, dpr);

    // Assigning width/height cleared both layers, so the wall must be redrawn
    // whatever it looked like a moment ago.
    bricksDirty = true;
    document.documentElement.style.setProperty('--cell-size', `${cell}px`);
  }

  let resizePending = 0;

  function scheduleResize() {
    // Debounce to one frame: a drag-resize fires this continuously.
    cancelAnimationFrame(resizePending);
    resizePending = requestAnimationFrame(resize);
  }

  const observer = new ResizeObserver(scheduleResize);
  observer.observe(container);

  const offWindowResize = () => {
    window.removeEventListener('resize', resize);
    window.removeEventListener('orientationchange', resize);
  };
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  const stopDprWatch = watchDpr(() => {
    palette.refresh();
    resize();
  });

  /* --- layers ------------------------------------------------------------- */

  function drawBricksLayer(state) {
    ctxBricks.clearRect(0, 0, width, height);

    const gap = cell * BRICK_GAP;
    const w = BRICK_W * cell - gap;
    const h = BRICK_H * cell - gap;
    const radius = Math.min(w, h) * palette.blockRadius;

    // One path and one fill per colour, rather than per brick. The wall is two
    // rows of each of four values, so this is four fills for 112 rectangles.
    for (const points of [7, 5, 3, 1]) {
      ctxBricks.fillStyle = palette.brick(points);
      ctxBricks.beginPath();
      let any = false;

      for (let row = 0; row < BRICK_ROWS; row++) {
        for (let col = 0; col < BRICK_COLS; col++) {
          const index = brickIndex(row, col);
          if (!isAlive(state.bricks, index)) continue;
          if (pointsOf(index) !== points) continue;
          pathRoundedRect(
            ctxBricks,
            brickLeft(index) * cell + gap / 2,
            brickTop(index) * cell + gap / 2,
            w, h, radius
          );
          any = true;
        }
      }
      if (any) ctxBricks.fill();
    }
  }

  const lerp = (from, to, t) => from + (to - from) * t;

  function pushTrail(x, y) {
    trailX[trailHead] = x;
    trailY[trailHead] = y;
    trailHead = (trailHead + 1) % TRAIL_LENGTH;
    if (trailCount < TRAIL_LENGTH) trailCount += 1;
  }

  function drawPlayLayer(state, alpha) {
    ctxPlay.clearRect(0, 0, width, height);

    // Frozen mid-flight looks like a glitch rather than a pause, and a bounce
    // inside this step means the straight line from previous to current cuts a
    // corner — both cases draw the resolved position instead.
    const t = isRunning(state.fsm) && !state.collidedThisStep ? Math.min(alpha, 1) : 1;

    const ballX = lerp(state.prevBallX, state.ball.x, t) * cell;
    const ballY = lerp(state.prevBallY, state.ball.y, t) * cell;
    const paddleX = lerp(state.prevPaddleX, state.paddle.x, t) * cell;

    /* Trail. Only while the ball is actually flying — a trail behind a ball
       parked on the paddle reads as a bug. */
    if (!state.ballAttached && isRunning(state.fsm)) {
      pushTrail(ballX, ballY);
      const r = BALL_RADIUS * cell;
      for (let n = 0; n < trailCount; n++) {
        // Walk backwards from the newest sample.
        const slot = (trailHead - 1 - n + TRAIL_LENGTH * 2) % TRAIL_LENGTH;
        const fade = (1 - n / trailCount) * 0.28;
        ctxPlay.globalAlpha = fade;
        drawBall(ctxPlay, trailX[slot], trailY[slot], r * (1 - n / trailCount) * 0.9, palette.ball);
      }
      ctxPlay.globalAlpha = 1;
    } else {
      trailCount = 0;
    }

    /* Paddle. */
    const pw = state.paddle.width * cell;
    const ph = PADDLE_H * cell;
    drawRect(
      ctxPlay,
      paddleX - pw / 2, PADDLE_Y * cell,
      pw, ph, ph / 2,
      palette.paddle
    );

    /* Ball, drawn last so it sits over the paddle while it waits to launch. */
    drawBall(ctxPlay, ballX, ballY, BALL_RADIUS * cell, palette.ball);
  }

  /* --- public ------------------------------------------------------------- */

  resize();

  // Re-measure once layout, fonts and scrollbars have settled. The first pass
  // can land before the grid has resolved, and without this the board keeps
  // whatever size that early measurement produced.
  requestAnimationFrame(resize);
  if (document.readyState !== 'complete') window.addEventListener('load', resize, { once: true });
  document.fonts?.ready.then(resize).catch(() => {});

  return {
    resize,

    /** Marks the wall for redraw. Called from the engine's event stream. */
    invalidateBricks() { bricksDirty = true; },

    render(state, alpha = 0) {
      if (!ctxPlay) return;
      if (bricksDirty) {
        drawBricksLayer(state);
        bricksDirty = false;
      }
      drawPlayLayer(state, alpha);
    },

    destroy() {
      observer.disconnect();
      offWindowResize();
      stopDprWatch();
      cancelAnimationFrame(resizePending);
    }
  };
}
