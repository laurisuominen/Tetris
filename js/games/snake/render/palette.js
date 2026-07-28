/**
 * Bridge between CSS custom properties and canvas drawing.
 *
 * Colours live in css/tokens.css and nowhere else. Canvas code cannot read a
 * custom property directly, so this resolves them once at boot and on theme
 * change, keeping a single source of truth.
 */

const TOKENS = {
  head: '--snake-head',
  body: '--snake-body',
  food: '--food',
  grid: '--grid-line',
  well: '--well-bg'
};

export function createPalette() {
  let colors = {};
  let blockRadius = 0.12;

  function refresh() {
    const styles = getComputedStyle(document.documentElement);
    const read = (token) => styles.getPropertyValue(token).trim();

    colors = Object.fromEntries(
      Object.entries(TOKENS).map(([name, token]) => [name, read(token)])
    );
    blockRadius = parseFloat(read('--block-radius')) || 0.12;
  }

  refresh();

  return {
    refresh,
    get head() { return colors.head || '#8de36b'; },
    get body() { return colors.body || '#5bbf46'; },
    get food() { return colors.food || '#f2555a'; },
    get grid() { return colors.grid; },
    get well() { return colors.well; },
    get blockRadius() { return blockRadius; }
  };
}
