/**
 * Cell drawing primitives.
 *
 * Rounded corners are built from arcTo rather than CanvasRenderingContext2D
 * roundRect. roundRect is the tidier call, but it is a comparatively recent
 * addition and this project ships no polyfills and no build step, so the
 * older primitive is the one that needs no support claim attached to it.
 *
 * Both helpers only append to the current path. Filling is the caller's job,
 * which is the point: the whole snake body goes into one path and takes one
 * fill, instead of one fill per segment at sixty frames a second.
 */

/** Appends a rounded rectangle to the current path. */
export function pathRoundedRect(ctx, x, y, size, radius) {
  const r = Math.min(radius, size / 2);
  const right = x + size;
  const bottom = y + size;

  ctx.moveTo(x + r, y);
  ctx.arcTo(right, y, right, bottom, r);
  ctx.arcTo(right, bottom, x, bottom, r);
  ctx.arcTo(x, bottom, x, y, r);
  ctx.arcTo(x, y, right, y, r);
  ctx.closePath();
}

/** One filled cell. For the few things drawn on their own. */
export function drawCell(ctx, x, y, size, color, radiusRatio = 0.12) {
  ctx.fillStyle = color;
  ctx.beginPath();
  pathRoundedRect(ctx, x, y, size, size * radiusRatio);
  ctx.fill();
}
