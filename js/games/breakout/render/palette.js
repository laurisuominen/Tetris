/**
 * Bridge between CSS custom properties and canvas drawing.
 *
 * Colours live in css/tokens.css and nowhere else. Canvas code cannot read a
 * custom property directly, so this resolves them once at boot and on theme
 * change, keeping a single source of truth.
 *
 * Brick colours are indexed by the row's POINT VALUE rather than by its row
 * number. The 1976 wall is two rows of each colour, and keying on the value is
 * what makes that pairing implicit — a row is orange because it is worth 5, not
 * because it is row 2.
 */

const TOKENS = {
  paddle: '--paddle',
  ball: '--ball',
  grid: '--grid-line',
  well: '--well-bg'
};

const BRICK_TOKENS = {
  7: '--brick-red',
  5: '--brick-orange',
  3: '--brick-green',
  1: '--brick-yellow'
};

const FALLBACK = {
  paddle: '#e2e8f0',
  ball: '#f8fafc',
  7: '#f43f5e',
  5: '#fb923c',
  3: '#4ade80',
  1: '#facc15'
};

export function createPalette() {
  let colors = {};
  let bricks = {};
  let blockRadius = 0.12;

  function refresh() {
    const styles = getComputedStyle(document.documentElement);
    const read = (token) => styles.getPropertyValue(token).trim();

    colors = Object.fromEntries(
      Object.entries(TOKENS).map(([name, token]) => [name, read(token)])
    );
    bricks = Object.fromEntries(
      Object.entries(BRICK_TOKENS).map(([points, token]) => [points, read(token)])
    );
    blockRadius = parseFloat(read('--block-radius')) || 0.12;
  }

  refresh();

  return {
    refresh,
    /** @param {number} points the brick row's value: 7, 5, 3 or 1 */
    brick(points) { return bricks[points] || FALLBACK[points] || FALLBACK.paddle; },
    get paddle() { return colors.paddle || FALLBACK.paddle; },
    get ball() { return colors.ball || FALLBACK.ball; },
    get grid() { return colors.grid; },
    get well() { return colors.well; },
    get blockRadius() { return blockRadius; }
  };
}
