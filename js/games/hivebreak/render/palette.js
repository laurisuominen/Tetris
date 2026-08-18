/**
 * Bridge between CSS custom properties and canvas drawing.
 *
 * Same job and same shape as Breakout's palette: colours live in css/tokens.css
 * and nowhere else, canvas code cannot read a custom property, so this resolves
 * them once at boot and again on theme change.
 *
 * The difference is that here the resolved values are also baked INTO the
 * sprite canvases, so `refresh()` alone is not enough — main.js must re-bake
 * the sprites after a theme change or the art keeps the old colours while
 * everything drawn directly picks up the new ones.
 */

import { ROLE_TOKENS } from './spriteData.js';

const EXTRA_TOKENS = {
  beam: '--hb-beam',
  shot: '--hb-shot',
  enemyShot: '--hb-enemy-shot',
  bossHit: '--hb-boss-hit',
  well: '--well-bg',
  grid: '--grid-line'
};

const FALLBACK = {
  beam: '#22d3ee',
  shot: '#f8fafc',
  enemyShot: '#f43f5e',
  bossHit: '#a855f7'
};

export function createPalette() {
  let roles = {};
  let extra = {};

  function refresh() {
    const styles = getComputedStyle(document.documentElement);
    const read = (token) => styles.getPropertyValue(token).trim();

    roles = Object.fromEntries(
      Object.entries(ROLE_TOKENS).map(([ch, token]) => [ch, read(token)])
    );
    extra = Object.fromEntries(
      Object.entries(EXTRA_TOKENS).map(([name, token]) => [name, read(token)])
    );
  }

  refresh();

  return {
    refresh,
    /** Colour for a sprite role character, or '' if the token is missing. */
    role(ch) { return roles[ch] ?? ''; },
    /** Colour for a token name, resolved at bake time for role overrides. */
    token(name) {
      const styles = getComputedStyle(document.documentElement);
      return styles.getPropertyValue(name).trim();
    },
    get beam() { return extra.beam || FALLBACK.beam; },
    get shot() { return extra.shot || FALLBACK.shot; },
    get enemyShot() { return extra.enemyShot || FALLBACK.enemyShot; },
    get well() { return extra.well; },
    get grid() { return extra.grid; }
  };
}
