/**
 * Rendering achievement badges: the shelf on the account page, the mark beside a
 * name on a leaderboard, and the sentence on the game-over card.
 *
 * The catalogue is imported from supabase/functions/_shared/badges.js rather
 * than duplicated here. That file is plain `.js` with zero imports for exactly
 * this reason — Deno, Node and the browser load the same definitions, so a badge
 * awarded by the Edge Function and a badge rendered by this module can never
 * disagree about what it is called. The path leaves js/ on purpose; the tests do
 * the same, and Supabase only reliably bundles shared code that lives under
 * supabase/functions/.
 *
 * This is `js/shared/` and it is NOT a violation of the "do not edit js/shared/
 * to add a game" rule: that rule is scoped to adding a game, and this module
 * imports no game-specific value. A fourth game needs no edit here — the shelf
 * groups by whatever games the catalogue defines.
 *
 * No innerHTML and no inline style attributes. Every page that renders this
 * ships `style-src 'self'` with no unsafe-inline, which governs style="" too, so
 * an inline style would be dropped silently and the badge would render unstyled.
 */

import { el } from '../util/dom.js';
import {
  BADGES, badgeFor, bestTier, SCORE_TIERS, GAME_TITLES
} from '../../../supabase/functions/_shared/badges.js';

/** The glyph every tier uses. Colour carries the tier; shape carries "badge". */
const MARK = '●';

/**
 * Section headings, in the order the shelf shows them.
 *
 * DERIVED from the catalogue, not listed. This was three hard-coded rows once,
 * and when Hivebreak's ladder was added its three badges silently vanished from
 * the shelf — while the count line above them still read "of 22", so a player
 * had three badges the UI would never show them and no way to tell why. A list
 * that has to track another list, with nothing enforcing it, is the same defect
 * `js/shared/net/leaderboard.js` had before Snake: game-BLIND rather than
 * game-agnostic. Deriving it is the fix, and it needs no argument because this
 * module already imports the catalogue.
 *
 * test/badges.test.js asserts every badge lands in exactly one section.
 */
export const GAME_SECTIONS = [
  { game: null, title: 'Arcade' },
  ...Object.keys(SCORE_TIERS).map((id) => ({ game: id, title: GAME_TITLES[id] ?? id }))
];

function earnedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function tierLabel(tier) {
  return tier ? `${tier.charAt(0).toUpperCase()}${tier.slice(1)}` : 'Badge';
}

/**
 * One badge, earned or not.
 *
 * A LOCKED HIDDEN BADGE SHOWS NEITHER ITS TITLE NOR ITS CRITERIA — that is what
 * hidden means, and revealing either would make it pointless. It still occupies
 * a slot, so the count at the top of the shelf adds up and nobody wonders
 * whether their list is broken.
 */
function shelfItem(badge, earnedAt) {
  // `undefined` means not held; `null` means held but with no usable timestamp,
  // which is why this tests for undefined rather than truthiness.
  const isEarned = earnedAt !== undefined;
  const concealed = badge.hidden && !isEarned;

  const item = el('li', {
    className: `shelf__item shelf__item--${badge.tier} ${isEarned ? 'is-earned' : 'is-locked'}`
  });

  item.appendChild(el('span', {
    className: 'shelf__mark',
    text: MARK,
    attrs: {
      role: 'img',
      'aria-label': concealed
        ? 'Hidden badge, not yet earned'
        : `${tierLabel(badge.tier)} badge, ${isEarned ? 'earned' : 'not yet earned'}`
    }
  }));

  const body = el('span', { className: 'shelf__body' });
  body.appendChild(el('span', {
    className: 'shelf__title',
    text: concealed ? 'Hidden badge' : badge.title
  }));
  body.appendChild(el('span', {
    className: 'shelf__desc',
    text: concealed ? 'Keep playing.' : badge.description
  }));

  const when = earnedDate(earnedAt);
  if (when) {
    body.appendChild(el('span', { className: 'shelf__when', text: `Earned ${when}` }));
  }

  item.appendChild(body);
  return item;
}

/**
 * The whole shelf: every badge in the catalogue, grouped by game, with the ones
 * this player holds marked as earned.
 *
 * LOCKED BADGES ARE SHOWN, not hidden. A shelf that lists only what you have
 * tells you nothing about what to do next, and "what to do next" is the entire
 * reason the feature exists. The one exception is the hidden badge, above.
 *
 * @param {Array<{key: string, earnedAt: string}>} earned as fetchMyBadges returns
 * @returns {HTMLElement}
 */
export function renderBadgeShelf(earned) {
  const earnedAtByKey = new Map(
    (earned ?? [])
      .filter((row) => row && typeof row.key === 'string')
      .map((row) => [row.key, row.earnedAt ?? null])
  );

  const wrap = el('div', { className: 'shelf' });

  wrap.appendChild(el('h3', { className: 'shelf__heading', text: 'Badges' }));
  wrap.appendChild(el('p', {
    className: 'shelf__count',
    text: `${earnedAtByKey.size} of ${BADGES.length} earned`
  }));

  for (const section of GAME_SECTIONS) {
    const badges = BADGES.filter((badge) => badge.game === section.game);
    // A section with nothing in it means the catalogue no longer defines that
    // game. Skip rather than render an empty heading.
    if (badges.length === 0) continue;

    wrap.appendChild(el('h4', { className: 'shelf__section', text: section.title }));

    const list = el('ul', { className: 'shelf__list' });
    for (const badge of badges) {
      const has = earnedAtByKey.has(badge.key);
      list.appendChild(shelfItem(badge, has ? earnedAtByKey.get(badge.key) : undefined));
    }
    wrap.appendChild(list);
  }

  return wrap;
}

/**
 * The single mark shown beside a name on a leaderboard, or null for a player
 * with no badges this build knows about.
 *
 * ONE MARK, NOT NINETEEN. A row of badges next to every name would bury the
 * score, which is what the table is actually about. The mark takes the colour of
 * the best tier held and says the count out loud to a screen reader, which is
 * the whole of the information a board row can usefully carry.
 *
 * Keys the catalogue does not define are ignored rather than counted — a browser
 * running a cached build can be handed a key from a newer deploy, and a mark
 * that says "4 badges" while listing three is worse than one that says three.
 *
 * @param {string[]} keys
 * @returns {HTMLElement|null}
 */
export function createBadgeMark(keys) {
  const known = (keys ?? []).filter((key) => badgeFor(key) !== null);
  if (known.length === 0) return null;

  const tier = bestTier(known);
  const label = known.length === 1 ? '1 badge earned' : `${known.length} badges earned`;

  return el('span', {
    className: `scores__mark scores__mark--${tier}`,
    text: MARK,
    attrs: { role: 'img', 'aria-label': `${label}, best ${tierLabel(tier).toLowerCase()}`, title: label }
  });
}

/**
 * "Badge unlocked: On the Board", for the post-run summary.
 *
 * Returns '' when nothing was unlocked, so a caller can decide with one test
 * whether the line is worth adding at all.
 *
 * WHERE THIS GOES: the post-run summary, not a mid-game toast. Interrupting play
 * to announce a badge is the failure mode every writeup on the subject warns
 * about, and the game-over card is already the screen the player is reading.
 *
 * Unknown keys are dropped. The player learns nothing from `score-pong-2`.
 */
export function unlockedSentence(keys) {
  const titles = (keys ?? [])
    .map((key) => badgeFor(key)?.title)
    .filter(Boolean);

  if (titles.length === 0) return '';

  const list = titles.length === 1
    ? titles[0]
    : `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;

  return `${titles.length === 1 ? 'Badge' : 'Badges'} unlocked: ${list}`;
}
