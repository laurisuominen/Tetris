# Product Spec: Browser Tetris (single `index.html`)

## 1. Goal & constraints
Build a fully playable Tetris game that runs by opening a single `index.html` file directly in a modern browser (Chrome/Firefox/Safari), no build step, no server.

- **One file**: all HTML, CSS, and JS inline in `index.html`. No external dependencies; no CDN.
- **Rendering**: HTML5 `<canvas>` for the playfield. Plain DOM/CSS for surrounding UI (score, next, hold, buttons).
- **No frameworks.** Vanilla JS.
- Target 60 FPS via `requestAnimationFrame` with a fixed-timestep accumulator (game logic must be frame-rate independent — do not tie gravity to frame count).
- Mechanics follow the **Tetris Guideline / SRS**. Where this doc gives explicit data (colors, kick tables, scoring), match it exactly.

## 2. Playfield
- Grid: **10 columns × 20 visible rows**. Maintain **20 hidden buffer rows above** (rows can spawn/rotate partly off-screen); only the bottom 20 are drawn.
- Coordinate convention for logic and the kick tables below: **+x = right, +y = up**. (If you store the grid top-down, translate consistently — the kick offsets assume +y up.)
- A cell is either empty or holds a color.

## 3. Tetrominoes
Seven pieces, each with a fixed color and 4×4 (I) or 3×3 (J,L,S,T,Z) / 2×2 (O) bounding box per the guideline.

| Piece | Color (hex) |
|-------|-------------|
| I | `#00f0f0` (cyan) |
| O | `#f0f000` (yellow) |
| T | `#a000f0` (purple) |
| S | `#00f000` (green) |
| Z | `#f00000` (red) |
| J | `#0000f0` (blue) |
| L | `#f0a000` (orange) |

Spawn orientation and column are guideline-standard: pieces spawn horizontally, centered, in the top buffer rows. I spawns spanning columns 3–6; O and the 3-wide pieces centered on columns 3–5. If the spawn cells are already occupied → **game over** (block out).

## 4. Rotation system (SRS)
Four states: `0` (spawn), `R` (one CW turn), `2` (180°), `L` (one CCW turn).

On a rotation input: compute the target orientation, then try each **wall-kick offset** in order until one lands in a valid (in-bounds, non-overlapping) position. If none works, the rotation fails and nothing moves. **O never kicks.**

Offsets are `(x, y)` with +x right, +y up, applied to the piece's position.

**J, L, S, T, Z kick table:**
```
0->R: (0,0) (-1,0) (-1,+1) (0,-2) (-1,-2)
R->0: (0,0) (+1,0) (+1,-1) (0,+2) (+1,+2)
R->2: (0,0) (+1,0) (+1,-1) (0,+2) (+1,+2)
2->R: (0,0) (-1,0) (-1,+1) (0,-2) (-1,-2)
2->L: (0,0) (+1,0) (+1,+1) (0,-2) (+1,-2)
L->2: (0,0) (-1,0) (-1,-1) (0,+2) (-1,+2)
L->0: (0,0) (-1,0) (-1,-1) (0,+2) (-1,+2)
0->L: (0,0) (+1,0) (+1,+1) (0,-2) (+1,-2)
```

**I kick table:**
```
0->R: (0,0) (-2,0) (+1,0) (-2,-1) (+1,+2)
R->0: (0,0) (+2,0) (-1,0) (+2,+1) (-1,-2)
R->2: (0,0) (-1,0) (+2,0) (-1,+2) (+2,-1)
2->R: (0,0) (+1,0) (-2,0) (+1,-2) (-2,+1)
2->L: (0,0) (+2,0) (-1,0) (+2,+1) (-1,-2)
L->2: (0,0) (-2,0) (+1,0) (-2,-1) (+1,+2)
L->0: (0,0) (+1,0) (-2,0) (+1,-2) (-2,+1)
0->L: (0,0) (-1,0) (+2,0) (-1,+2) (+2,-1)
```

## 5. Piece generation
- **7-bag randomizer**: shuffle all 7 pieces, deal them out, reshuffle a new bag when empty. Never allow the same-bag guarantees to break.
- **Next queue**: show the next **5** pieces.

## 6. Movement, gravity, locking
- **Move left/right**: one cell if valid.
- **Soft drop**: accelerated descent (e.g. 20× gravity) while held; awards points (§8).
- **Hard drop**: instantly drop to landing position, lock immediately; awards points (§8).
- **Gravity** (seconds per one-cell drop), guideline curve:
  `dropInterval = (0.8 - (level - 1) * 0.007) ^ (level - 1)` seconds.
  (Level 1 ≈ 0.8s; increases speed each level; at high levels it becomes sub-frame — cap by allowing multiple drops per frame.)
- **Lock delay**: once a piece rests on a surface, it does not lock instantly — wait **0.5s**. Any successful move or rotation **resets** the timer (**move reset**), capped at **15 resets** per piece; after the cap, lock on next contact regardless. If the piece is moved/rotated into open space it resumes falling.

## 7. Ghost piece & hold
- **Ghost piece**: a translucent outline showing where the current piece will hard-drop. Update on every move/rotate.
- **Hold**: pressing hold swaps the current piece into a hold slot (spawns the held piece, or the next piece if hold was empty). **Only one hold per piece** until the next piece locks — show the hold slot greyed out while locked.

## 8. Scoring
Per the guideline. `level` = current level.

| Action | Points |
|--------|--------|
| 1 line (Single) | 100 × level |
| 2 lines (Double) | 300 × level |
| 3 lines (Triple) | 500 × level |
| 4 lines (Tetris) | 800 × level |
| Soft drop | 1 × cells dropped |
| Hard drop | 2 × cells dropped |

**Optional (implement if straightforward):** T-spin detection (3-corner rule) with T-spin Single/Double/Triple bonuses (800/1200/1600 × level), and **Back-to-Back** ×1.5 multiplier for consecutive Tetrises/T-spins. If skipped, note it in a README comment. Do not let optional features block core delivery.

## 9. Levels & line clears
- Track total lines cleared. **Level = floor(totalLines / 10) + 1** (starts at 1).
- Line clear: rows fully filled are removed; rows above shift down. If multiple non-adjacent rows clear, all clear simultaneously.
- A brief clear animation (flash/collapse, ≤ 300ms) is desirable but must not desync input or scoring.

## 10. Controls (keyboard)
| Key | Action |
|-----|--------|
| ← / → | Move left / right |
| ↓ | Soft drop |
| Space | Hard drop |
| ↑ or X | Rotate CW |
| Z or Ctrl | Rotate CCW |
| A | Rotate 180° |
| C or Shift | Hold |
| P or Esc | Pause / resume |

- **DAS/ARR**: left/right auto-repeat when held — initial delay (DAS) ~170ms, then repeat (ARR) ~50ms. Soft drop repeats at soft-drop speed.
- Prevent the page from scrolling on arrow/space keypress.

## 11. Game states & UI
States: **Start/Menu → Playing → Paused → Game Over**, with restart from Game Over.

Layout (single screen, no scrolling):
- Center: playfield canvas (10×20), crisp grid, subtle cell borders.
- Left panel: **Hold** slot.
- Right panel: **Next** queue (5 pieces).
- Score panel: **Score, Level, Lines**.
- Overlays for Paused and Game Over (Game Over shows final score + Restart button/key).
- Responsive enough to fit common laptop screens; canvas scales but keeps aspect ratio and stays pixel-crisp.

## 12. Acceptance criteria
The build is done when all of these hold:
1. Opening `index.html` (double-click, `file://`) starts a playable game — no console errors.
2. All 7 pieces spawn with correct colors and 7-bag distribution (no long droughts).
3. SRS rotations and wall kicks behave per the tables (test: T-spin into a slot succeeds; I-piece kicks off walls).
4. Soft drop, hard drop, ghost piece, and hold all work; hold is limited to once per piece.
5. Lock delay is 0.5s with move-reset capped at 15.
6. Line clears, scoring, and level/gravity progression match §8–§9.
7. Pause halts gravity and input; resume continues exactly.
8. Game over triggers on block-out; restart resets score/board/level cleanly.
9. Gravity is time-based and identical across different-refresh-rate displays (60/120/144Hz).
10. Arrow keys and space do not scroll the page.

## 13. Deliverable
A single `index.html`. Include brief comments on architecture (game loop, board model, piece/rotation logic) and note any optional features (§8) that were or weren't implemented.
