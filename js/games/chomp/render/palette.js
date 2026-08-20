/**
 * Bridge between CSS custom properties and canvas drawing.
 *
 * Colours live in css/tokens.css and nowhere else. Canvas code cannot read a
 * custom property, so this resolves them once at boot and on theme change.
 *
 * As in Hivebreak, resolved values are also baked INTO the sprite canvases, so
 * `refresh()` alone is not enough — the sprites must be re-baked too, or the
 * ghosts keep the old theme's colours while the maze picks up the new one.
 */

import { GHOST } from '../core/constants.js';

const TOKENS = {
  wall: '--ch-wall',
  door: '--ch-door',
  dot: '--ch-dot',
  energizer: '--ch-energizer',
  player: '--ch-player',
  fright: '--ch-fright',
  frightLit: '--ch-fright-lit',
  eyes: '--ch-eyes',
  pupil: '--ch-pupil',
  well: '--well-bg'
};

const GHOST_TOKENS = ['--ch-blinky', '--ch-pinky', '--ch-inky', '--ch-clyde'];

const FALLBACK = {
  wall: '#2563eb', door: '#f9a8d4', dot: '#fbcfa4', energizer: '#ffffff',
  player: '#facc15', fright: '#1e3a8a', frightLit: '#f8fafc',
  eyes: '#f8fafc', pupil: '#1d4ed8'
};

export function createPalette() {
  let colors = {};
  let ghosts = [];

  function refresh() {
    const styles = getComputedStyle(document.documentElement);
    const read = (token) => styles.getPropertyValue(token).trim();
    colors = Object.fromEntries(
      Object.entries(TOKENS).map(([name, token]) => [name, read(token)])
    );
    ghosts = GHOST_TOKENS.map(read);
  }

  refresh();

  return {
    refresh,
    /** @param {number} id GHOST.BLINKY | PINKY | INKY | CLYDE */
    ghost(id) { return ghosts[id] || FALLBACK.player; },
    token(name) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    },
    get wall() { return colors.wall || FALLBACK.wall; },
    get door() { return colors.door || FALLBACK.door; },
    get dot() { return colors.dot || FALLBACK.dot; },
    get energizer() { return colors.energizer || FALLBACK.energizer; },
    get player() { return colors.player || FALLBACK.player; },
    get fright() { return colors.fright || FALLBACK.fright; },
    get frightLit() { return colors.frightLit || FALLBACK.frightLit; },
    get eyes() { return colors.eyes || FALLBACK.eyes; },
    get pupil() { return colors.pupil || FALLBACK.pupil; },
    get well() { return colors.well; }
  };
}

export { GHOST };
