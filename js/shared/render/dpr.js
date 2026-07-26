/**
 * Device pixel ratio handling.
 *
 * Sizes a canvas so its backing store matches physical pixels while all drawing
 * code continues to work in CSS pixels. v1 hardcoded width="300" height="600"
 * and was blurry on every scaled or retina display.
 */

import { backingSize } from './geometry.js';

export const getDpr = () => window.devicePixelRatio || 1;

/**
 * Resizes a canvas and scales its context.
 *
 * Note: assigning width/height CLEARS the canvas, so every caller must treat a
 * resize as invalidating the layer and redraw it.
 */
export function sizeCanvas(canvas, cssWidth, cssHeight, dpr = getDpr()) {
  const { width, height } = backingSize(cssWidth, cssHeight, dpr);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/**
 * Calls back whenever the ratio changes — browser zoom, or dragging the window
 * to a monitor with different scaling.
 *
 * The media query has to be re-registered each time because it is pinned to a
 * specific dppx value; there is no "any resolution change" query.
 */
export function watchDpr(onChange) {
  let query = null;
  let cancelled = false;

  const listen = () => {
    if (cancelled) return;
    const dpr = getDpr();
    query = matchMedia(`(resolution: ${dpr}dppx)`);
    query.addEventListener('change', handle, { once: true });
  };

  const handle = () => {
    if (cancelled) return;
    onChange(getDpr());
    listen();
  };

  listen();

  return () => {
    cancelled = true;
    query?.removeEventListener('change', handle);
  };
}
