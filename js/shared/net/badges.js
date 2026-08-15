/**
 * Reading achievement badges. The write side lives in the submit-score Edge
 * Function and there is no client path to it, by design — a badge a client can
 * award is a claim the client gets to author, which is the same defect
 * `leaderboard.is_verified` exists to avoid.
 *
 * In `net/` because it touches the network, and separate from leaderboard.js
 * because it is a different table and a different question. Both import the one
 * Supabase client from client.js; a second createClient would be a second auth
 * state (see that file).
 *
 * CONVENTION, INHERITED: throw, do not swallow. Supabase returns `{ data, error }`
 * rather than rejecting, so an unchecked call reads as success. Callers decide
 * what a failure means — for the leaderboard page an unmarked name is an
 * acceptable degradation, for the account page it is an error state — and that
 * decision belongs in the UI layer, not here.
 *
 * NAME YOUR COLUMNS. Grants on both tables read from here are column-level, and
 * PostgreSQL expands `*` to every column and checks privilege on all of them, so
 * `.select('*')` is 42501 rather than a filtered row. That applies to filtering
 * and ordering too, not just to what comes back.
 */

import { supabase } from './client.js';
import { getSession } from './auth.js';

/**
 * The signed-in player's own achievement keys, best-known first is NOT promised
 * — order is by earned_at, oldest first, which is the order they happened.
 *
 * Returns [] when signed out rather than throwing: "nobody is signed in" is a
 * normal state for a page that renders a sign-in card, not a failure.
 *
 * @returns {Promise<Array<{key: string, earnedAt: string}>>}
 */
export async function fetchMyBadges() {
  const session = await getSession();
  if (!session) return [];

  const { data, error } = await supabase
    .from('player_achievements')
    .select('achievement_key, earned_at')
    .eq('user_id', session.user.id)
    .order('earned_at', { ascending: true });

  if (error) {
    console.error('Error fetching achievements:', error);
    throw error;
  }

  return (data ?? []).map((row) => ({
    key: row.achievement_key,
    earnedAt: row.earned_at
  }));
}

/**
 * Achievement keys for a set of gamer tags, for marking names on a board.
 *
 * TWO QUERIES, AND THERE IS NO WAY TO MAKE IT ONE. `player_achievements` is
 * keyed by user id, the board carries display names, and `leaderboard.user_id`
 * is deliberately not granted to clients — it is the link the accounts migration
 * withholds precisely so nobody can stitch board rows into one player's history.
 * The public `profiles` directory is the sanctioned way across: a tag maps to an
 * id, and that mapping is already public because both columns are granted.
 *
 * Only pass VERIFIED names. An anonymous row's three initials belong to nobody
 * — `AAA` in particular is shared by unrelated players — so looking one up would
 * either find nothing or, worse, find a real account that happened to claim that
 * tag and hang a stranger's badges off it.
 *
 * @param {string[]} tags
 * @returns {Promise<Map<string, string[]>>} tag -> keys. Tags with no account or
 *   no badges are simply absent from the map.
 */
export async function fetchBadgesForTags(tags) {
  const wanted = Array.from(new Set((tags ?? []).filter((tag) => typeof tag === 'string' && tag)));
  if (wanted.length === 0) return new Map();

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, gamer_tag')
    .in('gamer_tag', wanted);

  if (profileError) {
    console.error('Error resolving gamer tags:', profileError);
    throw profileError;
  }

  if (!profiles || profiles.length === 0) return new Map();

  const tagById = new Map(profiles.map((row) => [row.id, row.gamer_tag]));

  const { data: earned, error: badgeError } = await supabase
    .from('player_achievements')
    .select('user_id, achievement_key')
    .in('user_id', Array.from(tagById.keys()));

  if (badgeError) {
    console.error('Error fetching achievements for the board:', badgeError);
    throw badgeError;
  }

  const byTag = new Map();
  for (const row of earned ?? []) {
    const tag = tagById.get(row.user_id);
    if (!tag) continue;
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push(row.achievement_key);
  }

  return byTag;
}
