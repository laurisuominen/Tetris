/**
 * "Report" link for a gamer tag on a leaderboard.
 *
 * Replaces an inline expanding control — a toggle that revealed a text input, a
 * Send button and a status line, all inside a table cell. Two things were wrong
 * with it and only one was cosmetic:
 *
 *   - It rendered EXPANDED. `panel.hidden = true` was set in JS, but
 *     `.report__panel { display: inline-flex }` in pages.css is an author rule
 *     and beats the user-agent's `[hidden] { display: none }`, so the attribute
 *     did nothing. Every reportable row carried an open form, which is exactly
 *     what the collapse was there to prevent.
 *   - Even collapsed, a form inside a table row fights the table: the cell has
 *     to hold a 12rem input next to a name, and at 375px the Send button
 *     wrapped to one letter per line.
 *
 * So the row now holds a link and nothing else, and the form lives on a page
 * with room for it. This module builds one anchor and has no state, no network
 * call and no styling of its own beyond a class.
 *
 * The href is root-absolute on purpose. This is shared code — the three callers
 * happen to sit at the same depth today, but encoding `../../../` here would
 * make that a silent requirement for the next one.
 */

import { el } from '../util/dom.js';

/** Where the report form lives. */
export const REPORT_PAGE = '/account/report/';

/**
 * @param {string} gamerTag The tag this link reports.
 * @returns {HTMLAnchorElement} An anchor to append next to the name.
 */
export function createReportLink(gamerTag) {
  const tag = String(gamerTag ?? '');

  return el('a', {
    className: 'report__link',
    text: 'Report',
    attrs: {
      // encodeURIComponent, not template interpolation on its own: a gamer tag
      // is [A-Za-z0-9_-] so nothing needs escaping today, but this link is also
      // built from `player_name` on ANONYMOUS rows, which is only ever three
      // characters the client wrote but is still free text as far as this file
      // is concerned.
      href: `${REPORT_PAGE}?tag=${encodeURIComponent(tag)}`,
      // "Report" alone is meaningless to a screen reader moving down a column
      // of them — the label has to carry which name it belongs to.
      'aria-label': `Report the gamer tag ${tag}`
    }
  });
}
