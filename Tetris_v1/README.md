# Tetris v1 — reference implementation

A complete, playable Tetris in a single `index.html` (~1000 lines, vanilla JS, no
dependencies). Open the file directly in a browser — no server needed.

This version is **kept as reference and is not published**. Active development
happens in [`../Tetris_v2/`](../Tetris_v2/), which is what GitHub Pages serves.

`Tetris_spec.md` in this directory is the original product spec. It remains the
source of truth for game rules in v2 as well.

## Known defects

Found while planning v2. They are documented here rather than fixed, since v1 is
frozen:

- **Level progression is twice as fast as specified.** `index.html:740` computes
  `Math.floor(this.lines / 5) + 1`; spec §9 says `/ 10`.
- **T-spins are over-awarded.** The rotation flag is never cleared by a gravity
  drop, so rotate → fall → lock scores as a T-spin. Mini vs. full is also
  collapsed to a bare 3-corner check with no front/back corner distinction.
- **Gravity breaks at extreme levels.** The curve's base goes negative around
  level 115, and a negative base raised to a fractional power is `NaN`, which
  would freeze the active piece.
- **180° rotation has no wall kicks**, making it unusable in a real stack.
- **No `devicePixelRatio` handling** — the canvas is blurry on scaled displays.
- **No responsive layout** — the game is clipped on narrow viewports.

## Why v1 is kept

v2 uses native ES modules, which browsers refuse to load over `file://` because
of CORS. v1 therefore remains the only version that runs by double-clicking a
file with nothing else installed.
