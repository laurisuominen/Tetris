/**
 * Local high-score table, kept per game.
 *
 * The storage key is a constructor argument so each game owns its own table —
 * the existing Tetris key is preserved verbatim by its caller, so nobody loses
 * a saved score.
 *
 * TWO KINDS OF NAME, and the difference is the reason this file is not a
 * one-liner. A player without an account types three initials, the arcade
 * convention; a signed-in player has a gamer tag they own, up to 15 characters
 * with mixed case. Until accounts existed only the first kind was possible, so
 * every name was clamped to `[A-Z0-9]{3}` on the way in — which quietly stored
 * the tag `SALT` as `SAL` and would have stored `Live30517` as `LIVE30517`.
 * The clamp is still exactly right for typed initials and must not be relaxed
 * for them: it is what stops a stray keystroke or a corrupt blob rendering as
 * a name.
 */

import { getItem, setItem } from './storage.js';

const MAX_ENTRIES = 10;

/**
 * Gamer tag limits, mirrored from the server's rule rather than imported.
 *
 * `supabase/functions/_shared/gamerTag.js` holds the real validator and is
 * deliberately loadable in a browser, so importing it here would work — and it
 * would be a mistake. That module carries the blocklist, and CLAUDE.md is
 * explicit that the client never sees the blocklist; the account page checks
 * shape only. Nothing reaches this function that has not already passed the
 * server's check at sign-up, so all that is owed here is a shape guard against
 * a corrupt localStorage blob or a future caller passing something odd.
 */
const TAG_MAX = 15;
const TAG_ALLOWED = /[^A-Za-z0-9_-]/g;

/** Typed initials: exactly three, uppercase, padded. The original rule. */
function toInitials(value) {
  return (value || 'AAA')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3)
    .padEnd(3, 'A');
}

/** An owned gamer tag: case and length preserved, character set enforced. */
function toTag(value) {
  return String(value || '').replace(TAG_ALLOWED, '').slice(0, TAG_MAX);
}

export function createScoresStore(key) {
  if (!key) throw new Error('createScoresStore requires a storage key');

  function loadScores() {
    const scores = getItem(key, []);
    if (!Array.isArray(scores)) return [];

    return scores
      .filter(s =>
        s && typeof s === 'object' &&
        typeof s.score === 'number' &&
        // Either shape is valid. `initials` is every row written before gamer
        // tags existed; requiring it would silently drop every new row, and
        // requiring `name` would drop every old one.
        (typeof s.name === 'string' || typeof s.initials === 'string')
      )
      // The single compatibility point in this module. Callers read `name` and
      // `verified` and never have to know two shapes exist on disk.
      .map(s => ({
        ...s,
        name: typeof s.name === 'string' ? s.name : s.initials,
        verified: s.verified === true
      }));
  }

  function saveScore(scoreEntry) {
    const scores = loadScores();

    // A verified entry keeps its tag; anything else is clamped to initials.
    // The fallback matters: if a tag sanitises down to nothing, storing an
    // empty name would render as a blank row, so it drops to the initials path
    // and gets a legible placeholder instead.
    const tag = scoreEntry.verified ? toTag(scoreEntry.name ?? scoreEntry.initials) : '';
    const verified = Boolean(scoreEntry.verified) && tag !== '';
    const name = verified ? tag : toInitials(scoreEntry.name ?? scoreEntry.initials);

    scores.push({
      ...scoreEntry,
      name,
      verified,
      date: scoreEntry.date || new Date().toISOString()
    });

    scores.sort((a, b) => b.score - a.score);
    const top = scores.slice(0, MAX_ENTRIES);
    setItem(key, top);
    return top;
  }

  function isHighScore(score) {
    if (score === 0) return false;
    const scores = loadScores();
    if (scores.length < MAX_ENTRIES) return true;
    return score > scores[scores.length - 1].score;
  }

  return { loadScores, saveScore, isHighScore };
}
