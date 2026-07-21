/**
 * Bridge between CSS custom properties and canvas drawing.
 *
 * Colours live in css/tokens.css and nowhere else. Canvas code cannot read a
 * custom property directly, so this resolves them once at boot and on theme
 * change, keeping a single source of truth.
 */

import { COLOR_TOKENS } from '../core/tetrominoes.js';
import { ORDINAL_TO_TYPE } from '../core/constants.js';

const UI_TOKENS = {
  grid: '--grid-line',
  well: '--well-bg',
  text: '--text-primary',
  accent: '--accent-strong'
};

export function createPalette() {
  let pieces = {};
  let ui = {};
  let ghostFill = 0.1;
  let ghostStroke = 0.55;
  let blockRadius = 0.12;

  function refresh() {
    const styles = getComputedStyle(document.documentElement);
    const read = (token) => styles.getPropertyValue(token).trim();

    pieces = Object.fromEntries(
      Object.entries(COLOR_TOKENS).map(([type, token]) => [type, read(token)])
    );
    ui = Object.fromEntries(
      Object.entries(UI_TOKENS).map(([name, token]) => [name, read(token)])
    );

    ghostFill = parseFloat(read('--ghost-fill-alpha')) || 0.1;
    ghostStroke = parseFloat(read('--ghost-stroke-alpha')) || 0.55;
    blockRadius = parseFloat(read('--block-radius')) || 0.12;
  }

  refresh();

  return {
    refresh,
    colorFor: (type) => pieces[type] ?? '#888',
    colorForOrdinal: (ordinal) => pieces[ORDINAL_TO_TYPE[ordinal]] ?? '#888',
    get grid() { return ui.grid; },
    get well() { return ui.well; },
    get text() { return ui.text; },
    get accent() { return ui.accent; },
    get ghostFillAlpha() { return ghostFill; },
    get ghostStrokeAlpha() { return ghostStroke; },
    get blockRadius() { return blockRadius; }
  };
}
