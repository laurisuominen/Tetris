/**
 * Bakes the text art in spriteData.js into canvases, once.
 *
 * THE POINT OF BAKING
 * -------------------
 * A sprite is 144 pixels. Drawing forty of them per frame as individual
 * fillRects is 5,760 fill calls a frame, which is exactly the kind of work
 * CLAUDE.md's 16.6ms budget cannot absorb. Painted once into a canvas, each
 * sprite is a single drawImage thereafter.
 *
 * WHY document.createElement AND NOT OffscreenCanvas
 * -------------------------------------------------
 * OffscreenCanvas would be tidier, but its support story is a fact this file
 * would have to assert and CLAUDE.md says not to assert those from memory. A
 * plain detached <canvas> has no such question hanging over it and is equally
 * fast as a drawImage source.
 *
 * CRISPNESS
 * ---------
 * Sprites are baked at the size they are drawn at, in DEVICE pixels, so
 * drawImage does no resampling. Each sprite pixel's edges are computed with
 * Math.round against the sprite's full width rather than by rounding a
 * per-pixel scale — rounding the scale accumulates error and leaves seams or
 * overlaps at the far edge. This way pixel N's right edge IS pixel N+1's left
 * edge, by construction, at any size.
 */

import { SPRITES, SPRITE_PX, ROLE_OVERRIDES, validateSprites } from './spriteData.js';

export function createSprites(palette) {
  const canvases = new Map();
  let bakedSize = 0;

  const problems = validateSprites();
  if (problems.length > 0) {
    // Loud, because the symptom otherwise is an enemy you cannot see.
    console.error('Hivebreak sprite data is malformed:\n' + problems.join('\n'));
  }

  function bakeOne(rows, overrides, sizePx) {
    const canvas = document.createElement('canvas');
    canvas.width = sizePx;
    canvas.height = sizePx;
    const ctx = canvas.getContext('2d');

    // Edge table: index i is where sprite-pixel i starts, in device pixels.
    const edge = new Array(SPRITE_PX + 1);
    for (let i = 0; i <= SPRITE_PX; i += 1) {
      edge[i] = Math.round((i * sizePx) / SPRITE_PX);
    }

    for (let y = 0; y < SPRITE_PX; y += 1) {
      const row = rows[y];
      for (let x = 0; x < SPRITE_PX; x += 1) {
        const ch = row[x];
        if (ch === '.') continue;

        const overrideToken = overrides?.[ch];
        const color = overrideToken ? palette.token(overrideToken) : palette.role(ch);
        if (!color) continue;

        ctx.fillStyle = color;
        ctx.fillRect(edge[x], edge[y], edge[x + 1] - edge[x], edge[y + 1] - edge[y]);
      }
    }
    return canvas;
  }

  return {
    /**
     * (Re)bakes every sprite at `sizePx` device pixels.
     *
     * Cheap enough to call on every resize and every theme change — it is a few
     * hundred fillRects, once, against thousands per frame if we did not.
     */
    bake(sizePx) {
      const size = Math.max(1, Math.round(sizePx));
      if (size === bakedSize && canvases.size > 0) return;
      bakedSize = size;
      canvases.clear();
      for (const [name, rows] of Object.entries(SPRITES)) {
        canvases.set(name, bakeOne(rows, ROLE_OVERRIDES[name], size));
      }
    },

    /** Forces a re-bake at the current size, for a theme change. */
    invalidate() {
      const size = bakedSize;
      bakedSize = 0;
      canvases.clear();
      if (size > 0) this.bake(size);
    },

    get(name) { return canvases.get(name) ?? null; },
    get size() { return bakedSize; }
  };
}
