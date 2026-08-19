/**
 * Hivebreak's tuning, in one place.
 *
 * COORDINATES
 * -----------
 * Everything in core/ is in TILES. The playfield is COLS x ROWS tiles, one
 * sprite fills one tile, and positions are fractional — the ship sits at
 * x = 6.9, not at "column 7". Nothing here knows what a screen pixel is; see
 * render/geometry.js for the single conversion.
 *
 * Tiles rather than the arcade's raw pixel grid is a deliberate choice, and it
 * is about `fitGrid` in js/shared/render/geometry.js. That helper snaps a cell
 * so `cell * dpr` is a whole number, which is what keeps sprite edges from
 * shimmering at fractional device ratios. Hand it a 224-unit-wide playfield and
 * the cell is ~1.8px, which snaps to 1px on a dpr-1 desktop — a 45% size loss.
 * Hand it 14 tiles and the cell is tens of pixels, where snapping costs a
 * percent or two.
 *
 * PORTRAIT, and not negotiable: a formation needs vertical room to dive into.
 */

/* --- playfield -------------------------------------------------------------- */

export const COLS = 14;
export const ROWS = 18;

/** Fixed simulation step. 60Hz, matching the other three games. */
export const TIMESTEP_MS = 1000 / 60;

/* --- the ship --------------------------------------------------------------- */

/** The ship's fixed row. It only ever moves along x. */
export const SHIP_Y = ROWS - 1.6;

/** Tiles per second. Crossing the full width takes a bit over 1.5s. */
export const SHIP_SPEED = 9;

/** Half-width of the ship's hitbox, in tiles. Deliberately under the sprite. */
export const SHIP_HALF_W = 0.34;

/** How far apart the two ships sit once a captive is rescued. */
export const DUAL_OFFSET = 0.9;

export const START_LIVES = 3;

/* --- guns ------------------------------------------------------------------- */

/**
 * Concurrent player bullets. Two is the arcade's limit and it is a real
 * mechanic, not a memory saving — it is what makes a missed shot cost
 * something. A dual fighter gets DUAL_BULLET_CAP instead.
 *
 * LOAD-BEARING: this and FIRE_COOLDOWN_MS below bound the scoring rate, and
 * that bound is what supabase/functions/submit-score/index.ts uses to reject
 * forged scores. Raise either and the deployed ceiling is silently too low.
 */
export const MAX_PLAYER_BULLETS = 2;
export const DUAL_BULLET_CAP = 4;

/** Minimum gap between shots. See the derivation in submit-score. */
export const FIRE_COOLDOWN_MS = 100;

/** Tiles per second, upward. */
export const BULLET_SPEED = 26;
export const ENEMY_BULLET_SPEED = 7.5;

export const MAX_ENEMY_BULLETS = 12;

/** Bullet hitbox half-extent, in tiles. */
export const BULLET_HALF_W = 0.07;
export const BULLET_HALF_H = 0.22;

/* --- the formation ---------------------------------------------------------- */

export const FORMATION_COLS = 8;
export const FORMATION_ROWS = 5;

/** Every slot in the grid, occupied or not. */
export const MAX_ENEMIES = FORMATION_COLS * FORMATION_ROWS;

/** Tile spacing between formation slots. */
export const FORMATION_GAP_X = 1.4;
export const FORMATION_GAP_Y = 1.15;

/** Where the formation's top-left slot sits when the breathing offset is zero. */
export const FORMATION_ORIGIN_X = (COLS - (FORMATION_COLS - 1) * FORMATION_GAP_X) / 2;
export const FORMATION_ORIGIN_Y = 2.4;

/** The formation sways horizontally. Amplitude in tiles, period in seconds. */
export const BREATHE_AMPLITUDE = 0.55;
export const BREATHE_PERIOD_S = 4.2;

/** Enemy hitbox half-extent, in tiles. */
export const ENEMY_HALF_W = 0.42;
export const ENEMY_HALF_H = 0.4;

/* --- enemy kinds ------------------------------------------------------------ */

export const KIND = Object.freeze({
  BEE: 'BEE',
  BUTTERFLY: 'BUTTERFLY',
  BOSS: 'BOSS'
});

/**
 * Which kind occupies each formation row, top to bottom.
 *
 * Row 0 is the boss row and is only half filled — bosses are rare, which is
 * what makes the tractor beam an event rather than a nuisance.
 */
export const ROW_KINDS = Object.freeze([
  KIND.BOSS,
  KIND.BUTTERFLY,
  KIND.BUTTERFLY,
  KIND.BEE,
  KIND.BEE
]);

/** Columns occupied in the boss row: the middle four. */
export const BOSS_COLUMNS = Object.freeze([2, 3, 4, 5]);

/** Hits to kill. A boss survives its first hit and changes colour. */
export const HITS_TO_KILL = Object.freeze({
  [KIND.BEE]: 1,
  [KIND.BUTTERFLY]: 1,
  [KIND.BOSS]: 2
});

/**
 * Points, in formation and while diving. Diving is worth more because it is
 * the harder shot and because it rewards leaving the formation alone.
 *
 * MAX_ENEMY_POINTS is the largest number here and feeds the score ceiling.
 */
export const POINTS = Object.freeze({
  [KIND.BEE]: { formation: 50, diving: 100 },
  [KIND.BUTTERFLY]: { formation: 80, diving: 160 },
  [KIND.BOSS]: { formation: 150, diving: 400 }
});

export const MAX_ENEMY_POINTS = 400;

/* --- stages ----------------------------------------------------------------- */

/**
 * LOAD-BEARING, same as Breakout's MAX_LEVEL: without a finite stage count the
 * maximum possible score is unbounded and submit-score cannot cap anything.
 */
export const MAX_STAGE = 99;

export const STAGE_CLEAR_BONUS = 1000;

/** Awarded once when a captured ship is shot free. */
export const RESCUE_BONUS = 1000;

/** Pause between stages, with the field frozen. */
export const STAGE_CLEAR_MS = 1600;

/** Pause after the ship explodes, before the next one flies in. */
export const RESPAWN_MS = 1400;

/* --- diving ----------------------------------------------------------------- */

/** Seconds between dive sorties at stage 1; falls with stage number. */
export const DIVE_INTERVAL_S = 2.6;
export const DIVE_INTERVAL_FLOOR_S = 0.75;

/** How much of the interval each stage removes. */
export const DIVE_INTERVAL_DECAY = 0.06;

/**
 * Hard cap on how many enemies may be OUT OF FORMATION at once.
 *
 * Concurrent, not per-sortie, and the distinction is the whole difficulty
 * curve. This was a per-sortie count first, which sounds equivalent and is not:
 * a sortie fires every DIVE_INTERVAL_S (2.6s at stage 1, less later) while a
 * dive path takes about 3.3s to fly, so sorties overlap BY CONSTRUCTION and
 * pressure compounds without limit. Measured over 60 simulated runs before the
 * fix: 7 divers in the air against a constant that said 4, median run length
 * 33 seconds, and no run past stage 4 at any skill level.
 *
 * A beaming boss counts against this too — it is holding station over the
 * player, which is not less dangerous than a pass.
 */
export const MAX_DIVERS = 4;

/**
 * How many leave together when a sortie goes, before the concurrent cap trims
 * it. Kept below MAX_DIVERS so a single sortie cannot fill the sky on its own.
 */
export const SORTIE_SIZE = 3;

/** Tiles per second along a dive path. */
export const DIVE_SPEED = 6.2;

/** Tiles per second along the opening entry path. */
export const ENTRY_SPEED = 7.4;

/** Chance per second that a diving enemy fires. */
export const DIVE_FIRE_RATE = 1.1;

/* --- the tractor beam ------------------------------------------------------- */

/** A boss will only try to capture when it dives from above this row. */
export const BEAM_ROW_Y = 11.5;

/** How long the beam stays open. */
export const BEAM_DURATION_MS = 2200;

/** Half-width of the cone at the ship's row. */
export const BEAM_HALF_W = 1.05;

/**
 * Seconds between capture attempts.
 *
 * A DEDICATED timer, not a roll inside the ordinary dive picker, and that is a
 * correction rather than a preference. It was a roll first: a boss had to be
 * chosen for a sortie (4 of 36 enemies, thinned by the sortie size) and then
 * pass a 45% check. Measured over a full simulated playthrough to stage 4, the
 * beam opened ZERO times — the mechanic the game is named for never appeared.
 * Compounding two low probabilities is how a signature feature becomes a
 * rumour. This timer guarantees it shows up; the randomness that remains is
 * which boss goes and whether the player is standing in the wrong place.
 */
export const BEAM_INTERVAL_S = 11;

/* --- particles -------------------------------------------------------------- */

/** Pre-allocated, per CLAUDE.md — nothing allocates inside the loop. */
export const MAX_PARTICLES = 96;
export const PARTICLE_LIFE_MS = 520;

/* --- difficulty tiers ------------------------------------------------------- */

/**
 * The player-facing speed setting. Scales dive frequency and enemy fire, never
 * the ship — a slower ship would feel broken rather than easier.
 */
export const SPEEDS = Object.freeze({
  CALM: 'CALM',
  CLASSIC: 'CLASSIC',
  FIERCE: 'FIERCE'
});

export const SPEED_FACTOR = Object.freeze({
  [SPEEDS.CALM]: 0.72,
  [SPEEDS.CLASSIC]: 1,
  [SPEEDS.FIERCE]: 1.35
});

/**
 * Player-facing labels for the tiers.
 *
 * The description names what actually changes, because "Fierce" on its own
 * invites the reasonable guess that the ship is faster too. It is not — only
 * the hive is.
 */
export const SPEED_TABLE = Object.freeze({
  [SPEEDS.CALM]: { label: 'Calm', blurb: 'fewer dives, slower' },
  [SPEEDS.CLASSIC]: { label: 'Classic', blurb: 'the arcade pace' },
  [SPEEDS.FIERCE]: { label: 'Fierce', blurb: 'constant pressure' }
});
