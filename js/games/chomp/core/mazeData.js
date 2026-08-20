/**
 * The board, as text.
 *
 * Same reasoning as Hivebreak's sprite data: the source reads as the thing it
 * describes and is reviewable in a diff. One character per tile, 28 wide by 31
 * rows — these are maze rows 3..33 of the 28x36 addressable screen, so add
 * MAZE_TOP to a row index here to get a simulation y.
 *
 *   #   wall
 *   .   dot            (240 of them)
 *   o   energizer      (4, in the corners)
 *   -   ghost-house door — ghosts pass, the player never does
 *   ' ' open, no pellet
 *
 * WHY THE INTERIOR OF A WALL BLOCK IS A SPACE, NOT A WALL. The classic maze is
 * drawn as hollow rounded boxes, and the tiles inside those boxes are
 * unreachable rather than solid. Marking them open costs nothing — they are
 * enclosed on all four sides — and it keeps this grid a faithful transcription
 * instead of an interpretation. The one place it matters is the ghost house,
 * whose interior IS reachable, by ghosts, through the door.
 *
 * Validated at load: exactly 240 dots and 4 energizers, 28x31, and every pellet
 * reachable from the player's start. See validateMaze below and the assertions
 * in test/chomp.test.js.
 */

export const MAZE_WIDTH = 28;
export const MAZE_HEIGHT = 31;

export const WALL = '#';
export const DOT = '.';
export const ENERGIZER = 'o';
export const DOOR = '-';
export const OPEN = ' ';

/** Rows 3..33 of the 28x36 screen. */
export const MAZE_ROWS_TEXT = Object.freeze([
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o#  #.#   #.##.#   #.#  #o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.##### ## #####.######',
  '     #.##### ## #####.#     ',
  '     #.##          ##.#     ',
  '     #.## ###--### ##.#     ',
  '######.## #      # ##.######',
  '      .   #      #   .      ',
  '######.## #      # ##.######',
  '     #.## ######## ##.#     ',
  '     #.##          ##.#     ',
  '     #.## ######## ##.#     ',
  '######.## ######## ##.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  '#o..##.......  .......##..o#',
  '###.##.##.########.##.##.###',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################'
]);

/**
 * Structural checks. A malformed board would show up as ghosts walking through
 * walls or a level that can never be cleared, neither of which names its cause.
 *
 * @returns {string[]} problems, empty when the board is sound
 */
export function validateMaze(rows = MAZE_ROWS_TEXT) {
  const problems = [];

  if (rows.length !== MAZE_HEIGHT) {
    problems.push(`${rows.length} rows, expected ${MAZE_HEIGHT}`);
  }
  rows.forEach((row, y) => {
    if (row.length !== MAZE_WIDTH) {
      problems.push(`row ${y}: ${row.length} columns, expected ${MAZE_WIDTH}`);
    }
    for (const ch of row) {
      if (![WALL, DOT, ENERGIZER, DOOR, OPEN].includes(ch)) {
        problems.push(`row ${y}: unknown tile '${ch}'`);
      }
    }
  });

  const dots = rows.reduce((n, r) => n + [...r].filter((c) => c === DOT).length, 0);
  const energizers = rows.reduce((n, r) => n + [...r].filter((c) => c === ENERGIZER).length, 0);
  if (dots !== 240) problems.push(`${dots} dots, expected 240`);
  if (energizers !== 4) problems.push(`${energizers} energizers, expected 4`);

  return problems;
}
