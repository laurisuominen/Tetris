/**
 * Canvas renderer.
 *
 * Three stacked layers sharing one grid cell, each with its own redraw trigger:
 *
 *   board  the locked stack and grid   redrawn when boardVersion changes
 *   piece  active piece and ghost      redrawn every frame (8 blocks)
 *   fx     clear sweep, lock pulse     redrawn only while effects are live
 *
 * v1 cleared and redrew up to 200 shadowed rounded rects every frame, including
 * the hold and next panels that change a few times a minute. Splitting by
 * change frequency is the single biggest performance difference in v2.
 */

import { COLS, VISIBLE_ROWS, TOTAL_ROWS, BUFFER_ROWS } from '../core/constants.js';
import { getCell } from '../core/board.js';
import { toBoardCells } from '../core/piece.js';
import { ghostPosition } from '../core/game.js';
import { sizeCanvas, getDpr, watchDpr } from './dpr.js';
import { fitPlayfield, crispOffset } from './geometry.js';
import { drawBlock, drawGhost, drawFlash } from './blocks.js';

export function createRenderer({ container, boardCanvas, pieceCanvas, fxCanvas, palette }) {
  let cell = 30;
  let dpr = getDpr();
  let ctxBoard = null;
  let ctxPiece = null;
  let ctxFx = null;

  let lastBoardVersion = -1;
  let effects = [];

  /* --- sizing ------------------------------------------------------------ */

  function resize() {
    const rect = container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    dpr = getDpr();
    const fit = fitPlayfield(rect.width, rect.height, dpr);
    cell = fit.cell;

    for (const canvas of [boardCanvas, pieceCanvas, fxCanvas]) {
      canvas.style.position = 'absolute';
      canvas.style.left = '50%';
      canvas.style.top = '50%';
      canvas.style.transform = 'translate(-50%, -50%)';
    }

    ctxBoard = sizeCanvas(boardCanvas, fit.width, fit.height, dpr);
    ctxPiece = sizeCanvas(pieceCanvas, fit.width, fit.height, dpr);
    ctxFx = sizeCanvas(fxCanvas, fit.width, fit.height, dpr);

    // Resizing clears the backing store, so every layer is now invalid.
    lastBoardVersion = -1;

    document.documentElement.style.setProperty('--cell-size', `${cell}px`);
  }

  let resizePending = 0;

  function scheduleResize() {
    // Debounce to one frame: a drag-resize fires this continuously.
    cancelAnimationFrame(resizePending);
    resizePending = requestAnimationFrame(resize);
  }

  // ResizeObserver is the precise signal, but it is not always delivered —
  // notably in background or embedded contexts where rAF is throttled. The
  // window listener and the settle pass below are the safety net: without them
  // a single early measurement taken before layout settles would stick, and the
  // board would render at the wrong size forever.
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

  /* --- coordinate helpers ------------------------------------------------ */

  /** Board row -> y in CSS pixels. Rows above the buffer are off-canvas. */
  const rowToY = (row) => (row - BUFFER_ROWS) * cell;
  const colToX = (col) => col * cell;
  const isVisible = (row) => row >= BUFFER_ROWS && row < TOTAL_ROWS;

  /* --- layers ------------------------------------------------------------ */

  function drawGrid() {
    const offset = crispOffset(dpr);
    ctxBoard.strokeStyle = palette.grid;
    ctxBoard.lineWidth = 1 / dpr;
    ctxBoard.beginPath();
    for (let col = 1; col < COLS; col++) {
      const x = colToX(col) + offset;
      ctxBoard.moveTo(x, 0);
      ctxBoard.lineTo(x, VISIBLE_ROWS * cell);
    }
    for (let row = 1; row < VISIBLE_ROWS; row++) {
      const y = row * cell + offset;
      ctxBoard.moveTo(0, y);
      ctxBoard.lineTo(COLS * cell, y);
    }
    ctxBoard.stroke();
  }

  function drawBoardLayer(state) {
    ctxBoard.clearRect(0, 0, COLS * cell, VISIBLE_ROWS * cell);
    drawGrid();

    const clearing = new Set(state.pendingRows ?? []);
    for (let row = BUFFER_ROWS; row < TOTAL_ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const ordinal = getCell(state.board, col, row);
        if (ordinal === 0) continue;
        drawBlock(ctxBoard, colToX(col), rowToY(row), cell,
                  palette.colorForOrdinal(ordinal),
                  { radiusRatio: palette.blockRadius });
        if (clearing.has(row)) {
          drawFlash(ctxBoard, colToX(col), rowToY(row), cell, 0.35);
        }
      }
    }
  }

  function drawPieceLayer(state) {
    ctxPiece.clearRect(0, 0, COLS * cell, VISIBLE_ROWS * cell);
    if (!state.piece) return;

    const color = palette.colorFor(state.piece.type);

    const ghost = ghostPosition(state);
    if (ghost && ghost.y !== state.piece.y) {
      for (const { col, row } of toBoardCells(ghost)) {
        if (!isVisible(row)) continue;
        drawGhost(ctxPiece, colToX(col), rowToY(row), cell, color, {
          fillAlpha: palette.ghostFillAlpha,
          strokeAlpha: palette.ghostStrokeAlpha,
          radiusRatio: palette.blockRadius
        });
      }
    }

    for (const { col, row } of toBoardCells(state.piece)) {
      if (!isVisible(row)) continue;
      drawBlock(ctxPiece, colToX(col), rowToY(row), cell, color,
                { radiusRatio: palette.blockRadius });
    }
  }

  function drawFxLayer(now) {
    if (effects.length === 0) {
      if (fxDirty) {
        ctxFx.clearRect(0, 0, COLS * cell, VISIBLE_ROWS * cell);
        fxDirty = false;
      }
      return;
    }

    ctxFx.clearRect(0, 0, COLS * cell, VISIBLE_ROWS * cell);
    fxDirty = true;

    effects = effects.filter((effect) => {
      const progress = (now - effect.start) / effect.duration;
      if (progress >= 1) return false;
      effect.draw(ctxFx, progress);
      return true;
    });
  }
  let fxDirty = false;

  /* --- public ------------------------------------------------------------ */

  resize();

  // Re-measure once layout, fonts and scrollbars have settled. The first pass
  // above can land before the grid has resolved, and without this the board
  // keeps whatever size that early measurement produced.
  requestAnimationFrame(resize);
  if (document.readyState !== 'complete') window.addEventListener('load', resize, { once: true });
  document.fonts?.ready.then(resize).catch(() => {});

  return {
    resize,

    render(state) {
      if (!ctxBoard) return;

      if (state.boardVersion !== lastBoardVersion) {
        drawBoardLayer(state);
        lastBoardVersion = state.boardVersion;
      }
      drawPieceLayer(state);
      drawFxLayer(performance.now());
    },

    /** Forces the stack to redraw — used when pendingRows change mid-clear. */
    invalidateBoard() { lastBoardVersion = -1; },

    /** Bright sweep across the rows being cleared. */
    addClearEffect(rows, duration) {
      const start = performance.now();
      effects.push({
        start,
        duration,
        draw(ctx, progress) {
          const width = COLS * cell;
          const head = width * progress;
          for (const row of rows) {
            if (!isVisible(row)) continue;
            const gradient = ctx.createLinearGradient(head - cell * 3, 0, head, 0);
            gradient.addColorStop(0, 'rgba(255,255,255,0)');
            gradient.addColorStop(1, `rgba(255,255,255,${0.85 * (1 - progress)})`);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, rowToY(row), head, cell);
          }
        }
      });
    },

    /** Brief flash on the cells that just locked. */
    addLockEffect(cells, duration = 160) {
      const start = performance.now();
      effects.push({
        start,
        duration,
        draw(ctx, progress) {
          const alpha = 0.5 * (1 - progress);
          for (const { col, row } of cells) {
            if (!isVisible(row)) continue;
            drawFlash(ctx, colToX(col), rowToY(row), cell, alpha);
          }
        }
      });
    },

    clearEffects() {
      effects = [];
      if (ctxFx) ctxFx.clearRect(0, 0, COLS * cell, VISIBLE_ROWS * cell);
    },

    destroy() {
      observer.disconnect();
      offWindowResize();
      stopDprWatch();
      cancelAnimationFrame(resizePending);
    }
  };
}
