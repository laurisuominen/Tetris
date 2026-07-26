/**
 * The arcade's game list — the single source of truth for what exists.
 *
 * Adding a game is one entry here plus a directory under /games/. Nothing else
 * in the hub knows any game's name.
 *
 * `path` is relative to the site root and must end in a slash so the directory
 * index resolves.
 */

/** @typedef {'playable' | 'soon'} GameStatus */

export const GAMES = Object.freeze([
  {
    id: 'tetris',
    title: 'Tetris',
    path: 'games/tetris/',
    status: 'playable',
    blurb: 'Guideline-accurate stacking with SRS kicks, T-spins and a 7-bag randomizer.',
    // Two-letter tile mark; the hub draws it rather than shipping icon files.
    mark: 'TT',
    accent: 'var(--piece-t)'
  },
  {
    id: 'snake',
    title: 'Snake',
    path: 'games/snake/',
    status: 'soon',
    blurb: 'Grow, turn, and try not to meet yourself coming the other way.',
    mark: 'SN',
    accent: 'var(--piece-s)'
  },
  {
    id: 'breakout',
    title: 'Breakout',
    path: 'games/breakout/',
    status: 'soon',
    blurb: 'One ball, one paddle, and a wall that will not clear itself.',
    mark: 'BR',
    accent: 'var(--piece-l)'
  }
]);

export const isPlayable = (game) => game.status === 'playable';
