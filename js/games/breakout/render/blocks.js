/**
 * Drawing primitives.
 *
 * Rounded corners are built from arcTo rather than CanvasRenderingContext2D
 * roundRect, matching the other two games: roundRect is the tidier call but a
 * comparatively recent addition, and this project ships no polyfills and no
 * build step, so the older primitive is the one that needs no support claim
 * attached to it.
 *
 * The path helpers only append to the current path. Filling is the caller's
 * job, which is the point: a whole row of bricks in one colour goes into one
 * path and takes one fill.
 */

/** Appends a rounded rectangle of arbitrary aspect to the current path. */
export function pathRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  const right = x + width;
  const bottom = y + height;

  ctx.moveTo(x + r, y);
  ctx.arcTo(right, y, right, bottom, r);
  ctx.arcTo(right, bottom, x, bottom, r);
  ctx.arcTo(x, bottom, x, y, r);
  ctx.arcTo(x, y, right, y, r);
  ctx.closePath();
}

/** One filled rounded rectangle. */
export function drawRect(ctx, x, y, width, height, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  pathRoundedRect(ctx, x, y, width, height, radius);
  ctx.fill();
}

/** One filled circle. */
export function drawBall(ctx, x, y, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}
