/**
 * Hold slot and next queue — spec §7 and §5.
 *
 * Redrawn only when their version counter changes. These contents alter a few
 * times a minute; v1 repainted them every frame.
 */

import { NEXT_COUNT } from '../core/constants.js';
import { SHAPES, BOX_SIZE } from '../core/tetrominoes.js';
import { sizeCanvas, getDpr } from './dpr.js';
import { fitPreview } from './geometry.js';
import { drawBlock } from './blocks.js';

/** Bounds of a piece's spawn shape, so it can be centred rather than boxed. */
function shapeBounds(type) {
  const cells = SHAPES[type][0];
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys)
  };
}

function drawPieceCentred(ctx, type, boxX, boxY, boxW, boxH, cell, palette) {
  const b = shapeBounds(type);
  const w = (b.maxX - b.minX + 1) * cell;
  const h = (b.maxY - b.minY + 1) * cell;
  const originX = boxX + (boxW - w) / 2;
  const originY = boxY + (boxH - h) / 2;
  const color = palette.colorFor(type);

  for (const { x, y } of SHAPES[type][0]) {
    drawBlock(
      ctx,
      originX + (x - b.minX) * cell,
      // +y up in shape space, +y down on canvas.
      originY + (b.maxY - y) * cell,
      cell,
      color,
      { radiusRatio: palette.blockRadius }
    );
  }
}

export function createPreviews({ holdCanvas, nextCanvas, palette }) {
  let lastHoldVersion = -1;
  let lastNextVersion = -1;
  let lastCanHold = null;

  /** The canvas's CSS box, which CSS sizes definitely (never from the backing). */
  function boxOf(canvas) {
    const r = canvas.getBoundingClientRect();
    return {
      w: Math.max(Math.round(r.width), 1),
      h: Math.max(Math.round(r.height), 1)
    };
  }

  function renderHold(type, canHold) {
    const { w, h } = boxOf(holdCanvas);
    const dpr = getDpr();
    const ctx = sizeCanvas(holdCanvas, w, h, dpr);
    ctx.clearRect(0, 0, w, h);

    holdCanvas.dataset.locked = String(!canHold);
    if (!type) return;

    const cell = fitPreview(w * 0.8, h * 0.8, 4, 3, dpr);
    drawPieceCentred(ctx, type, 0, 0, w, h, cell, palette);
  }

  /**
   * Next queue. The layout adapts to the box CSS gives it: a tall box (desktop
   * side panel) stacks the pieces vertically; a wide box (mobile top strip)
   * lays them in a row. Sizing is bounded by CSS in both cases, so the preview
   * can never blow up and crush the board — which is exactly what an
   * unbounded `width × 3.1` height used to do on a phone.
   */
  function renderNext(types) {
    const { w, h } = boxOf(nextCanvas);
    console.log("NEXTCANVAS", w, h, nextCanvas.getBoundingClientRect());
    
    const dpr = getDpr();
    const ctx = sizeCanvas(nextCanvas, w, h, dpr);
    ctx.clearRect(0, 0, w, h);

    const list = types.slice(0, NEXT_COUNT);
    if (list.length === 0) return;

    if (h >= w) {
      // Vertical column.
      const slot = h / NEXT_COUNT;
      const cell = fitPreview(w * 0.7, slot * 0.72, 4, 2, dpr);
      list.forEach((type, i) => drawPieceCentred(ctx, type, 0, i * slot, w, slot, cell, palette));
    } else {
      // Horizontal row.
      const slot = w / list.length;
      const cell = fitPreview(slot * 0.8, h * 0.72, 4, 2, dpr);
      list.forEach((type, i) => drawPieceCentred(ctx, type, i * slot, 0, slot, h, cell, palette));
    }
  }

  return {
    render(state, nextTypes) {
      if (state.holdVersion !== lastHoldVersion || state.canHold !== lastCanHold) {
        renderHold(state.hold, state.canHold);
        lastHoldVersion = state.holdVersion;
        lastCanHold = state.canHold;
      }
      if (state.queueVersion !== lastNextVersion) {
        renderNext(nextTypes);
        lastNextVersion = state.queueVersion;
      }
    },

    /** Called on resize and palette change, when the cached draw is stale. */
    invalidate() {
      lastHoldVersion = -1;
      lastNextVersion = -1;
      lastCanHold = null;
    }
  };
}
