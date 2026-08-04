/**
 * The global board's per-player rule, as a pure function.
 *
 * One player with ten good runs used to be able to hold every slot on the
 * global top 10, which turns the board into a record of who played most rather
 * than a contest. Each name now appears at most three times.
 *
 * ZERO IMPORTS, AND THAT IS THE POINT. This sits in net/ beside its only caller
 * but touches nothing — no client, no fetch, no browser global. leaderboard.js
 * cannot be imported under Node because client.js reads `window.supabase` at
 * module evaluation and throws, so a rule written inside that file would be
 * permanently untestable. Here it runs in both runners.
 *
 * WHY THIS IS A DISPLAY RULE AND NOT A PRUNE RULE
 *
 * The obvious alternative is to teach public.prune_leaderboard to keep three
 * per player, so the plain top-10 query is correct with no client change at
 * all. It was rejected because pruning DELETES, and the grouping key available
 * here is a display name, not an identity:
 *
 *   - Anonymous rows carry typed-in initials. `AAA` is also what
 *     scoresStore's toInitials() pads to when nothing is typed, so it is the
 *     single most likely name on the board and is shared by people with no
 *     connection to each other. Capping it at three on the write path would
 *     permanently destroy other players' scores.
 *   - Hiding a row is reversible. Deleting one is not.
 *
 * So the rows stay in the table and the board shows a fair slice of them.
 */

/** Rows one name may occupy on the global board. */
export const MAX_PER_PLAYER = 3;

/** Rows the global board shows. Unchanged — this rule refills those slots. */
export const BOARD_SIZE = 10;

/**
 * Rows to ask the database for before filtering.
 *
 * This is not a guess: public.prune_leaderboard(100) runs on every insert, so
 * the table holds at most 100 rows per game and fetching 100 sees ALL of them.
 * That makes the filtered top 10 exact rather than approximate — no dominant
 * player can push a rival's qualifying score past the end of the window,
 * because there is nothing past the end of the window.
 *
 * It is therefore coupled to the retention constant in
 * migrations/20260730000000_prune_leaderboard_per_game.sql. Raise retention
 * without raising this and the rule silently degrades to "top 3 per player
 * among the best 100", which is still sane but no longer exact.
 */
export const FETCH_LIMIT = 100;

/**
 * Grouping key for a row.
 *
 * The display name, case-folded. Two things worth being explicit about, since
 * neither is ideal and both are forced:
 *
 *   - `user_id` would be the correct key for a signed-in player, but it is
 *     deliberately not granted to anon/authenticated (see the accounts
 *     migration: it is the link that would deanonymise a board), so the client
 *     cannot see it. For a verified row the gamer tag is a fair proxy anyway —
 *     profiles.gamer_tag_key is uniquely indexed, so one live tag is one
 *     account.
 *   - Verified and anonymous rows with the same name SHARE the quota rather
 *     than getting three each. Splitting them would put `SALT ✓` and a
 *     look-alike `SALT` on the same board six times over, which reads as
 *     broken. The cost is that someone typing another player's tag consumes
 *     their slots; that is impersonation, and the remedy for it is reporting,
 *     not a quota.
 */
function playerKey(row) {
  return String(row?.player_name ?? '').trim().toLowerCase();
}

/**
 * Keep each name's best `perPlayer` rows, then the best `limit` rows overall.
 *
 * `rows` MUST already be sorted best-first — this walks them once in order and
 * never re-sorts, so an unsorted input yields a wrong answer rather than an
 * error. The caller orders by score desc, created_at asc, matching the tie-break
 * prune_leaderboard uses; without a deterministic tie-break two equal scores
 * would swap places between page loads and one of them would flicker on and off
 * the board.
 *
 * Both counts are required rather than defaulted, the same reason createLoop
 * requires a timestep: a silently wrong quota looks exactly like a working
 * board.
 */
export function capPerPlayer(rows, perPlayer, limit) {
  if (!Number.isInteger(perPlayer) || perPlayer < 1) {
    throw new Error('capPerPlayer requires a positive integer perPlayer');
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('capPerPlayer requires a positive integer limit');
  }
  if (!Array.isArray(rows)) return [];

  const used = new Map();
  const kept = [];

  for (const row of rows) {
    if (kept.length >= limit) break;
    const key = playerKey(row);
    const count = used.get(key) ?? 0;
    if (count >= perPlayer) continue;
    used.set(key, count + 1);
    kept.push(row);
  }

  return kept;
}
