/**
 * Decorating an already-rendered leaderboard with achievement marks.
 *
 * WHY THIS IS A SECOND PASS AND NOT PART OF renderTable.
 *
 * The badge query cannot start until the board has come back, because it is
 * keyed by the gamer tags that are ON the board. Doing it before the table
 * renders would put a second serial round trip in front of the thing the page
 * exists to show, so the table appears as soon as the scores do and the marks
 * arrive when they arrive. A board with no marks is a board; a board that is
 * still spinning is not.
 *
 * SEPARATE FROM badgeShelf.js on purpose. That module renders and imports
 * nothing from net/, which is what lets it stay a pure DOM module. This one is
 * the join between it and the network, and it is the only place the two meet.
 */

import { fetchBadgesForTags } from '../net/badges.js';
import { createBadgeMark } from './badgeShelf.js';

/**
 * Fetches badges for every tag on the board and inserts one mark after each
 * anchor element.
 *
 * @param {Map<string, Element[]>} anchorsByTag gamer tag -> the elements to
 *   insert after. Usually the verified tick, so the mark lands between the tick
 *   and the report link rather than at the end of the cell. One tag can appear
 *   up to three times on a board (the per-player cap), hence an array.
 * @returns {Promise<void>} resolves when the marks are in, or when the lookup
 *   failed and was logged. Never rejects.
 *
 * A FAILURE HERE IS SILENT ON SCREEN, and that is the right trade for this one
 * case. leaderboard.js throws rather than returning [] because a swallowed error
 * there rendered "No global scores yet" over a full table — a lie. An absent
 * badge mark makes no claim at all: the board still shows every score, every
 * name and every verified tick. Nothing on screen is wrong, there is just less
 * of it. The console gets the error.
 */
export function attachBadgeMarks(anchorsByTag) {
  if (!anchorsByTag || anchorsByTag.size === 0) return Promise.resolve();

  return fetchBadgesForTags(Array.from(anchorsByTag.keys()))
    .then((byTag) => {
      for (const [tag, anchors] of anchorsByTag) {
        const keys = byTag.get(tag);
        if (!keys || keys.length === 0) continue;
        for (const anchor of anchors) {
          // A fresh element per anchor. The same node cannot sit in two rows —
          // appending it a second time MOVES it, which would leave the first
          // row silently unmarked.
          const mark = createBadgeMark(keys);
          if (mark) anchor.after(mark);
        }
      }
    })
    .catch((error) => {
      console.error('Could not load achievement marks for the board', error);
    });
}
