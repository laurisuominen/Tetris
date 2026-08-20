/**
 * Chomp's rules, in one place. Nearly all of it is arcade data rather than
 * design — see the Sources note at the bottom.
 *
 * COORDINATES: 28 x 36 TILES, NOT 28 x 31.
 * ----------------------------------------
 * The maze proper is 31 rows, but the arcade addresses a 36-row screen: three
 * rows of score above and two of lives/fruit below. Every documented constant
 * is in THAT system, and two of them are meaningless without it — Blinky's
 * scatter target is (25, 0) and Inky's is (27, 34), both in the dead space
 * outside the maze. Shifting the maze to a 31-row origin would silently move
 * every scatter corner and every red-zone row.
 *
 * So the simulation is 28 x 36 and the RENDERER crops to rows 3..33. That costs
 * one offset in render/geometry.js and keeps every number below verbatim.
 */

/* --- playfield -------------------------------------------------------------- */

export const COLS = 28;
/** Full addressable height, including the score rows the maze does not use. */
export const ROWS = 36;

/** The maze occupies rows MAZE_TOP..MAZE_BOTTOM inclusive. */
export const MAZE_TOP = 3;
export const MAZE_BOTTOM = 33;
export const MAZE_ROWS = MAZE_BOTTOM - MAZE_TOP + 1;   // 31

/** Fixed simulation step. 60Hz, matching the other four games and the arcade. */
export const TIMESTEP_MS = 1000 / 60;

/**
 * Speed base, in tiles per second, for "100%".
 *
 * DERIVED, and worth showing because the Dossier gives only percentages. The
 * arcade runs at 60Hz and full speed is one PIXEL per frame; a tile is 8
 * pixels. So 100% = 60 px/s = 7.5 tiles/s. Every percentage below multiplies
 * this.
 *
 * Continuous sub-pixel movement is used rather than the arcade's move/skip tick
 * pattern. That is a deliberate improvement, not a shortcut: the tick pattern is
 * an integer approximation OF these percentages, so applying the percentages
 * directly is closer to the documented intent than reproducing the rounding.
 */
export const BASE_SPEED = 7.5;

/* --- directions ------------------------------------------------------------- */

/**
 * Order matters. At a junction a ghost picks the closest tile, and ties break
 * up > left > down > right. Iterating this array IS that tie-break, so nothing
 * has to sort.
 */
export const DIRS = Object.freeze([
  { name: 'UP',    dx: 0,  dy: -1 },
  { name: 'LEFT',  dx: -1, dy: 0 },
  { name: 'DOWN',  dx: 0,  dy: 1 },
  { name: 'RIGHT', dx: 1,  dy: 0 }
]);

export const UP = 0;
export const LEFT = 1;
export const DOWN = 2;
export const RIGHT = 3;

export const OPPOSITE = Object.freeze([DOWN, RIGHT, UP, LEFT]);

/* --- the ghosts ------------------------------------------------------------- */

export const GHOST = Object.freeze({
  BLINKY: 0,
  PINKY: 1,
  INKY: 2,
  CLYDE: 3
});

export const GHOST_NAMES = Object.freeze(['BLINKY', 'PINKY', 'INKY', 'CLYDE']);

/**
 * Scatter targets, in 28x36 tile space. All four sit OUTSIDE the maze, which is
 * why they are never reached and why a scattering ghost circles its corner
 * forever instead.
 */
export const SCATTER_TARGETS = Object.freeze([
  { x: 25, y: 0 },    // Blinky  — top right
  { x: 2,  y: 0 },    // Pinky   — top left
  { x: 27, y: 34 },   // Inky    — bottom right
  { x: 0,  y: 34 }    // Clyde   — bottom left
]);

/** Clyde drops his pursuit inside this radius. Measured in tiles, squared below. */
export const CLYDE_SHY_DISTANCE = 8;

/* --- the board -------------------------------------------------------------- */

/** Tunnel row, and the columns on each side that wrap. */
export const TUNNEL_ROW = 17;
export const TUNNEL_LEFT_MAX = 5;
export const TUNNEL_RIGHT_MIN = 22;

/**
 * The two "red zones": ghosts may not TURN upward here, though they may keep
 * travelling up if already doing so. Frightened ghosts ignore the restriction.
 *
 * Both sit directly above the ghost house and above the lower centre corridor,
 * and they are what stops ghosts escaping certain chases. Removing them makes
 * the game markedly harder in a way no player would recognise as authentic.
 */
export const RED_ZONE_X_MIN = 11;
export const RED_ZONE_X_MAX = 16;
export const RED_ZONE_ROWS = Object.freeze([14, 26]);

/** Ghost house geometry, in tiles. Fractional x/y are legal — actors move sub-tile. */
export const HOUSE_DOOR = Object.freeze({ x: 14, y: 14.5 });
export const HOUSE_CENTRE = Object.freeze({ x: 14, y: 17.5 });
export const HOUSE_SLOTS = Object.freeze([
  { x: 14, y: 14.5 },   // Blinky starts OUTSIDE, above the door
  { x: 14, y: 17.5 },   // Pinky   — middle
  { x: 12, y: 17.5 },   // Inky    — left
  { x: 16, y: 17.5 }    // Clyde   — right
]);

export const PLAYER_START = Object.freeze({ x: 14, y: 26.5 });

/** Where a bonus fruit sits. */
export const FRUIT_TILE = Object.freeze({ x: 14, y: 20.5 });

/* --- scoring ---------------------------------------------------------------- */

export const DOT_POINTS = 10;
export const ENERGIZER_POINTS = 50;

/** Chain per energizer, reset when the next one is eaten. */
export const GHOST_CHAIN = Object.freeze([200, 400, 800, 1600]);

export const TOTAL_DOTS = 240;
export const TOTAL_ENERGIZERS = 4;

/** An extra life, once. The arcade awards it at 10,000. */
export const EXTRA_LIFE_AT = 10_000;

export const START_LIVES = 3;

/** Dots eaten before each fruit appears, and how long it stays. */
export const FRUIT_AT_DOTS = Object.freeze([70, 170]);
export const FRUIT_VISIBLE_MS = 9500;

/* --- per-level tables ------------------------------------------------------- */

/**
 * LOAD-BEARING. MAX_LEVEL is what makes the maximum possible score finite, and
 * supabase/functions/submit-score/index.ts derives its cap from it. Raise it and
 * the deployed ceiling is silently too low, which rejects honest scores.
 *
 * 255 rather than the arcade's rollover-at-256, because the 256th-level kill
 * screen is deliberately out of scope.
 */
export const MAX_LEVEL = 255;

/** Bonus fruit by level: [name, points]. Level 13+ is always the key. */
export const FRUIT_TABLE = Object.freeze([
  ['CHERRY', 100], ['STRAWBERRY', 300], ['PEACH', 500], ['PEACH', 500],
  ['APPLE', 700], ['APPLE', 700], ['GRAPES', 1000], ['GRAPES', 1000],
  ['GALAXIAN', 2000], ['GALAXIAN', 2000], ['BELL', 3000], ['BELL', 3000],
  ['KEY', 5000]
]);

export const MAX_FRUIT_POINTS = 5000;

/**
 * Frightened seconds and flash count, per level. Index 0 is level 1.
 * Zero seconds means the ghosts still REVERSE but never turn blue — which is
 * what makes the late levels brutal.
 */
export const FRIGHT_TABLE = Object.freeze([
  [6, 5], [5, 5], [4, 5], [3, 5], [2, 5], [5, 5], [2, 5], [2, 5],
  [1, 3], [5, 5], [2, 5], [1, 3], [1, 3], [3, 5], [1, 3], [1, 3],
  [0, 0], [1, 3], [0, 0], [0, 0], [0, 0]
]);

/** Cruise Elroy: dots REMAINING at which Blinky speeds up, stage 1 and 2. */
export const ELROY_TABLE = Object.freeze([
  [20, 10], [30, 15], [40, 20], [40, 20], [40, 20], [50, 25], [50, 25], [50, 25],
  [60, 30], [60, 30], [60, 30], [80, 40], [80, 40], [80, 40], [100, 50],
  [100, 50], [100, 50], [100, 50], [120, 60], [120, 60], [120, 60]
]);

/**
 * Speed percentages by level band: [player, playerEatingDots, ghost,
 * ghostFrightened, ghostTunnel].
 *
 * Note the player is SLOWER while eating dots. That is not flavour — it is the
 * mechanism by which ghosts close the gap, and a version without it plays
 * nothing like the original.
 */
export const SPEED_BANDS = Object.freeze([
  { upTo: 1,   player: 0.80, playerDots: 0.71, ghost: 0.75, fright: 0.50, tunnel: 0.40 },
  { upTo: 4,   player: 0.90, playerDots: 0.79, ghost: 0.85, fright: 0.55, tunnel: 0.45 },
  { upTo: 20,  player: 1.00, playerDots: 0.87, ghost: 0.95, fright: 0.60, tunnel: 0.50 },
  { upTo: Infinity, player: 0.90, playerDots: 0.79, ghost: 0.95, fright: 0.60, tunnel: 0.50 }
]);

/** Cruise Elroy speed bumps, added to the ghost percentage. */
export const ELROY_SPEED_BONUS = Object.freeze([0.05, 0.10]);

/**
 * NOT DOCUMENTED ANYWHERE, and flagged as such rather than dressed up.
 *
 * The Dossier is silent on how fast eaten eyes return to the house and how fast
 * ghosts drift inside it. These are estimates, chosen to feel right; the widely
 * used C reference makes the same two guesses and says so. If a source turns up,
 * replace them and say where it came from.
 */
export const EYES_SPEED = 1.5;      // multiple of BASE_SPEED
export const HOUSE_SPEED = 0.5;

/* --- scatter / chase schedule ----------------------------------------------- */

/**
 * Phase durations in seconds, alternating scatter, chase, scatter, chase...
 * A phase of Infinity means the ghosts stay there for the rest of the level.
 *
 * The 1/60 entries are REAL and deliberate. From level 2 the fourth scatter
 * lasts a single frame — long enough to force the mandatory direction reversal
 * and nothing else. Round it to zero and the reversal never fires.
 */
export const PHASE_TABLE = Object.freeze({
  1:  Object.freeze([7, 20, 7, 20, 5, 20, 5, Infinity]),
  4:  Object.freeze([7, 20, 7, 20, 5, 1033, 1 / 60, Infinity]),
  Infinity: Object.freeze([5, 20, 5, 20, 5, 1037, 1 / 60, Infinity])
});

/* --- ghost house release ---------------------------------------------------- */

/**
 * Dots that must be eaten before each ghost leaves, by level band. Blinky is
 * never in the house, so his entry is 0 throughout.
 */
export const HOUSE_LIMITS = Object.freeze({
  1: Object.freeze([0, 0, 30, 60]),
  2: Object.freeze([0, 0, 0, 50]),
  Infinity: Object.freeze([0, 0, 0, 0])
});

/**
 * After a death the personal counters are abandoned for a GLOBAL one, and these
 * are its thresholds. When Clyde's is reached the global counter is switched off
 * and personal counters resume — a detail that matters, because a player who
 * dies twice quickly would otherwise face a differently-timed house.
 */
export const GLOBAL_RELEASE = Object.freeze([0, 7, 17, 32]);

/** Idle failsafe: leave anyway if no dot is eaten for this long. */
export const RELEASE_TIMEOUT_MS = 4000;
export const RELEASE_TIMEOUT_MS_L5 = 3000;

/* --- timings ---------------------------------------------------------------- */

export const READY_MS = 2000;
export const DEATH_PAUSE_MS = 1600;
export const LEVEL_CLEAR_MS = 1800;
/** How long the score sits on screen after a ghost is eaten. */
export const GHOST_EATEN_PAUSE_MS = 500;

/* --- player control --------------------------------------------------------- */

/**
 * How far from a tile centre the PLAYER may take a perpendicular turn, in tiles.
 *
 * This is CORNERING, and the asymmetry is the point: the player may turn early,
 * ghosts may only turn at a tile centre. That is what lets a player gain ground
 * on a chasing ghost of equal speed, and it is why the original is playable at
 * level 21 when the ghosts are strictly faster.
 *
 * HONEST ABOUT THE APPROXIMATION: the arcade corners by moving DIAGONALLY for a
 * few pixels. This snaps to the new lane instead, which is the same advantage
 * delivered a simpler way — but it is not pixel-identical, and a player counting
 * frames would find the corner-cut slightly different. Ghosts get a tolerance of
 * effectively zero, so the relative benefit survives.
 */
export const PLAYER_CORNER_TOLERANCE = 0.4;

/** Ghosts commit at the centre. Small tolerance only to absorb float error. */
export const GHOST_TURN_TOLERANCE = 0.06;

/* --- difficulty tiers ------------------------------------------------------- */

/**
 * The player-facing setting. Unlike the other games this shifts the STARTING
 * LEVEL rather than inventing speeds — every speed here is arcade data, and
 * making up a fifth column would throw that away.
 */
export const SPEEDS = Object.freeze({
  CLASSIC: 'CLASSIC',
  BRISK: 'BRISK',
  FIERCE: 'FIERCE'
});

export const SPEED_TABLE = Object.freeze({
  [SPEEDS.CLASSIC]: { label: 'Classic', startLevel: 1, blurb: 'start at level 1, as the arcade does' },
  [SPEEDS.BRISK]: { label: 'Brisk', startLevel: 5, blurb: 'start at level 5 — full speed, shorter scatters' },
  [SPEEDS.FIERCE]: { label: 'Fierce', startLevel: 13, blurb: 'start at level 13 — barely any frightened time' }
});

/*
 * SOURCES
 * -------
 * Ghost targeting, mode schedule, speed percentages, level tables, house release
 * rules and the cornering behaviour: The Pac-Man Dossier, Jamey Pittman —
 * https://pacman.holenet.info/ (mirror: gamedeveloper.com/design/the-pac-man-dossier)
 *
 * Scatter target tiles, red-zone coordinates, tunnel bounds and starting
 * positions: the Dossier gives these only in diagrams, so they were taken from a
 * ROM-derived reference implementation and then CHECKED against the board —
 * see test/chomp.test.js, which asserts the red zones sit above the house and
 * the tunnel row is walkable to both edges.
 */
