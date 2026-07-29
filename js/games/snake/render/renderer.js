/**
 * Canvas renderer.
 *
 * Two stacked layers with very different redraw rates:
 *
 *   grid  the well and its gridlines   redrawn only on resize
 *   play  snake and food               redrawn every frame
 *
 * INTERPOLATION — the reason this looks like a game and not a slideshow.
 *
 * The snake moves 5-14 times a second. Drawn snapped to its grid cells at those
 * rates it reads as a flipbook, which is how most browser Snakes look. So the
 * two ends are drawn part-way between cells.
 *
 * The progress value is NOT createLoop's `alpha`. `alpha` is progress through a
 * 16.7ms loop step; a move spans roughly seven of those, so lerping on `alpha`
 * alone makes the snake lurch seven times per cell. What is wanted is progress
 * through the MOVE, which the reducer tracks as moveTimerMs:
 *
 *     t = (moveTimerMs + alpha * TIMESTEP_MS) / moveIntervalMs
 *
 * The alpha term is what keeps it smooth between simulation steps rather than
 * quantised to 60 discrete positions.
 *
 * Only the head and tail move between ticks — every segment in the middle is
 * exactly where it was — so the body is one path with one fill.
 */

import { COLS, ROWS, TIMESTEP_MS } from '../core/constants.js';
import { isRunning } from '../core/fsm.js';
import { slotOf } from '../core/snake.js';
import { sizeCanvas, getDpr, watchDpr } from '../../../shared/render/dpr.js';
import { crispOffset } from '../../../shared/render/geometry.js';
import { fitPlayfield } from './geometry.js';
import { pathRoundedRect, drawCell } from './blocks.js';

export function createRenderer({ container, gridCanvas, playCanvas, palette }) {
  let cell = 20;
  let dpr = getDpr();
  let ctxGrid = null;
  let ctxPlay = null;
  let width = 0;
  let height = 0;

  /* --- sizing ------------------------------------------------------------ */

  function resize() {
    const rect = container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    dpr = getDpr();
    const fit = fitPlayfield(rect.width, rect.height, dpr);
    cell = fit.cell;
    width = fit.width;
    height = fit.height;

    for (const canvas of [gridCanvas, playCanvas]) {
      canvas.style.position = 'absolute';
      canvas.style.left = '50%';
      canvas.style.top = '50%';
      canvas.style.transform = 'translate(-50%, -50%)';

      // Pin the CSS box to the fitted size. Leaving the stylesheet's
      // width/height:100% in charge stretches the element to the whole stack,
      // which is not exactly square once the slab's padding is counted, so the
      // grid would be drawn at the fitted size and then scaled by a few percent
      // -- undoing the device-pixel snapping fitPlayfield exists to provide.
      canvas.style.width = `${fit.width}px`;
      canvas.style.height = `${fit.height}px`;
    }

    ctxGrid = sizeCanvas(gridCanvas, fit.width, fit.height, dpr);
    ctxPlay = sizeCanvas(playCanvas, fit.width, fit.height, dpr);

    drawGridLayer();
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

  /* --- layers ------------------------------------------------------------ */

  function drawGridLayer() {
    ctxGrid.clearRect(0, 0, width, height);

    const offset = crispOffset(dpr);
    ctxGrid.strokeStyle = palette.grid;
    ctxGrid.lineWidth = 1 / dpr;
    ctxGrid.beginPath();
    for (let col = 1; col < COLS; col++) {
      const x = col * cell + offset;
      ctxGrid.moveTo(x, 0);
      ctxGrid.lineTo(x, height);
    }
    for (let row = 1; row < ROWS; row++) {
      const y = row * cell + offset;
      ctxGrid.moveTo(0, y);
      ctxGrid.lineTo(width, y);
    }
    ctxGrid.stroke();
  }

  /**
   * Position of a moving end, part-way between two cells.
   *
   * Adjacent cells lerp; anything further apart is a wrap-around, where the
   * head left one edge and reappeared at the other. Interpolating that would
   * slide the head backwards across the entire board over one move, so it
   * snaps instead.
   */
  function lerpAxis(from, to, t) {
    return Math.abs(to - from) > 1 ? to : from + (to - from) * t;
  }

  function drawPlayLayer(state, alpha) {
    ctxPlay.clearRect(0, 0, width, height);

    const body = state.body;
    const radius = cell * palette.blockRadius;

    // Frozen mid-cell looks like a glitch rather than a pause, so anything not
    // actively running is drawn sitting exactly on the grid.
    const t = isRunning(state.fsm)
      ? Math.min(1, (state.moveTimerMs + alpha * TIMESTEP_MS) / state.moveIntervalMs)
      : 1;

    /* Food. A slow breath so it reads as the thing to go and get. */
    if (state.food >= 0) {
      const fx = (state.food % COLS) * cell;
      const fy = Math.floor(state.food / COLS) * cell;
      const pulse = 0.82 + 0.06 * Math.sin(performance.now() / 260);
      const size = cell * pulse;
      const inset = (cell - size) / 2;
      drawCell(ctxPlay, fx + inset, fy + inset, size, palette.food, palette.blockRadius);
    }

    /* Body: every segment except the head, in one path and one fill. */
    ctxPlay.fillStyle = palette.body;
    ctxPlay.beginPath();
    for (let n = 1; n < body.length; n++) {
      const slot = slotOf(body, n);
      let x = body.segX[slot];
      let y = body.segY[slot];

      // Only the last segment is in motion; the rest have not moved this tick.
      if (n === body.length - 1 && state.tailMoved) {
        x = lerpAxis(state.prevTailX, x, t);
        y = lerpAxis(state.prevTailY, y, t);
      }

      pathRoundedRect(ctxPlay, x * cell, y * cell, cell, radius);
    }
    ctxPlay.fill();

    /* Head, drawn last so it sits over the neck. */
    const hx = lerpAxis(state.prevHeadX, body.segX[body.head], t);
    const hy = lerpAxis(state.prevHeadY, body.segY[body.head], t);
    drawCell(ctxPlay, hx * cell, hy * cell, cell, palette.head, palette.blockRadius);
  }

  /* --- public ------------------------------------------------------------ */

  resize();

  // Re-measure once layout, fonts and scrollbars have settled. The first pass
  // can land before the grid has resolved, and without this the board keeps
  // whatever size that early measurement produced.
  requestAnimationFrame(resize);
  if (document.readyState !== 'complete') window.addEventListener('load', resize, { once: true });
  document.fonts?.ready.then(resize).catch(() => {});

  return {
    resize,

    render(state, alpha = 0) {
      if (!ctxPlay) return;
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
