/**
 * Drawing a single cell.
 *
 * Modern-minimal treatment: a filled rounded rect with a soft inner highlight
 * along the top edge and a matching shadow along the bottom. Enough to read as
 * a physical tile without the heavy 3D bevel that dates the look.
 */

/** Slight inset so adjacent blocks read as separate tiles rather than a slab. */
const INSET_RATIO = 0.04;

function roundedRect(ctx, x, y, size, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, radius);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x  left edge in CSS pixels
 * @param {number} y  top edge in CSS pixels
 * @param {number} size  cell size in CSS pixels
 */
export function drawBlock(ctx, x, y, size, color, { radiusRatio = 0.12 } = {}) {
  const inset = size * INSET_RATIO;
  const s = size - inset * 2;
  const radius = s * radiusRatio;
  const left = x + inset;
  const top = y + inset;

  ctx.fillStyle = color;
  roundedRect(ctx, left, top, s, radius);
  ctx.fill();

  // Top-edge highlight and bottom-edge shade, both clipped to the tile.
  ctx.save();
  ctx.clip();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fillRect(left, top, s, Math.max(s * 0.14, 1));

  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fillRect(left, top + s - Math.max(s * 0.14, 1), s, Math.max(s * 0.14, 1));

  ctx.restore();
}

/**
 * The ghost — spec §7.
 *
 * An inset outline plus a faint wash, rather than v1's flat 30%-alpha copy,
 * which was hard to tell apart from a real block against a busy stack.
 */
export function drawGhost(ctx, x, y, size, color, { fillAlpha = 0.1, strokeAlpha = 0.55, radiusRatio = 0.12 } = {}) {
  const inset = size * INSET_RATIO;
  const s = size - inset * 2;
  const radius = s * radiusRatio;
  const left = x + inset;
  const top = y + inset;

  ctx.save();
  ctx.globalAlpha = fillAlpha;
  ctx.fillStyle = color;
  roundedRect(ctx, left, top, s, radius);
  ctx.fill();

  ctx.globalAlpha = strokeAlpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(size * 0.06, 1);
  roundedRect(ctx, left + ctx.lineWidth / 2, top + ctx.lineWidth / 2,
              s - ctx.lineWidth, Math.max(radius - ctx.lineWidth / 2, 0));
  ctx.stroke();
  ctx.restore();
}

/** Bright overlay used by the lock pulse and line-clear sweep. */
export function drawFlash(ctx, x, y, size, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.restore();
}
