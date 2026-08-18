/**
 * The sprite art, as text.
 *
 * WHY STRINGS AND NOT A PNG
 * -------------------------
 * This repo has no binary assets and no asset pipeline, and adding one for a
 * fourth game would buy a loader, a decode-before-start gate, a service-worker
 * caching rule and a brand new 404 failure mode on GitHub Pages. A missing file
 * under supabase/functions/_shared/ took the whole site down on 2026-08-16;
 * art that cannot 404 is worth a little verbosity.
 *
 * So each sprite is an array of equal-length strings, one character per pixel,
 * and render/sprites.js paints them into a canvas once at boot. The source
 * reads as the picture it draws, which is the part a PNG cannot offer.
 *
 * Every sprite is SPRITE_PX square and fills exactly one tile of the playfield.
 *
 * '.' is transparent. Every other character is a COLOUR ROLE resolved through
 * ROLE_TOKENS below — never a literal colour, so a theme change repaints the
 * art without touching this file.
 */

/** Pixels per side. Changing this means redrawing everything below. */
export const SPRITE_PX = 12;

/**
 * Character -> CSS custom property.
 *
 * A role missing from tokens.css bakes as transparent, which shows up as an
 * invisible enemy — see the note in tokens.css. sprites.js warns rather than
 * failing silently.
 */
export const ROLE_TOKENS = Object.freeze({
  h: '--hb-hull',
  H: '--hb-hull-lit',
  t: '--hb-thrust',
  b: '--hb-bee',
  B: '--hb-bee-body',
  f: '--hb-fly',
  F: '--hb-fly-body',
  g: '--hb-boss',
  e: '--hb-eye'
});

/** The player's fighter, nose up. Engine flare on the last row. */
const SHIP = Object.freeze([
  '.....HH.....',
  '.....HH.....',
  '....hHHh....',
  '....hHHh....',
  '...hhHHhh...',
  '...hhHHhh...',
  '..hhhHHhhh..',
  '..hhhHHhhh..',
  '.hhhhHHhhhh.',
  'hhhhhHHhhhhh',
  'hh.hhhhhh.hh',
  '.....tt.....'
]);

/** Bee: the small one, bottom two formation rows. Narrow wings. */
const BEE = Object.freeze([
  '............',
  '..b......b..',
  '..bb....bb..',
  '...bb..bb...',
  '...bBBBBb...',
  '..bBeBBeBb..',
  '..bBBBBBBb..',
  '...BBBBBB...',
  '...B.BB.B...',
  '..b.B..B.b..',
  '..b......b..',
  '............'
]);

/** Butterfly: middle rows. Wide wings, so it reads as bigger than a bee. */
const BUTTERFLY = Object.freeze([
  '............',
  '.f........f.',
  '.ff......ff.',
  '.fff....fff.',
  '..ffFFFFff..',
  '..fFeFFeFf..',
  '..fFFFFFFf..',
  '..ffFFFFff..',
  '.fff....fff.',
  '.ff......ff.',
  '.f........f.',
  '............'
]);

/**
 * Boss: the top row, and the only enemy that survives a hit.
 *
 * ONE pixel grid, baked twice with the 'g' role bound to a different colour —
 * see BOSS_VARIANTS. Duplicating the art for the damaged form would mean two
 * pictures that could drift apart while meaning the same thing.
 */
const BOSS = Object.freeze([
  '...g....g...',
  '..gg....gg..',
  '.ggg....ggg.',
  '.gggggggggg.',
  'ggggHHHHgggg',
  'gggHeHHeHggg',
  'gggHHHHHHggg',
  '.ggggHHgggg.',
  '.gggg..gggg.',
  '..gg....gg..',
  '..g......g..',
  '............'
]);

export const SPRITES = Object.freeze({
  SHIP,
  BEE,
  BUTTERFLY,
  BOSS,
  /** Same grid as BOSS; sprites.js rebinds 'g' to the damaged colour. */
  BOSS_HIT: BOSS
});

/** Sprites whose 'g' role is overridden at bake time. */
export const ROLE_OVERRIDES = Object.freeze({
  BOSS_HIT: { g: '--hb-boss-hit' }
});

/**
 * Guard: every row of every sprite must be SPRITE_PX wide and there must be
 * SPRITE_PX of them. A short row would silently shift the rest of the picture
 * left, which is the kind of thing that looks like a rendering bug for an hour.
 */
export function validateSprites() {
  const problems = [];
  for (const [name, rows] of Object.entries(SPRITES)) {
    if (rows.length !== SPRITE_PX) {
      problems.push(`${name}: ${rows.length} rows, expected ${SPRITE_PX}`);
    }
    rows.forEach((row, y) => {
      if (row.length !== SPRITE_PX) {
        problems.push(`${name} row ${y}: ${row.length} chars, expected ${SPRITE_PX}`);
      }
      for (const ch of row) {
        if (ch !== '.' && !ROLE_TOKENS[ch]) {
          problems.push(`${name} row ${y}: unknown role '${ch}'`);
        }
      }
    });
  }
  return problems;
}
