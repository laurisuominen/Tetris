/**
 * The only module in the codebase that talks to the network.
 *
 * Both functions take the game id as a REQUIRED argument and throw without it,
 * matching createLoop(timestep), createAutoRepeat(das/arr) and
 * createScoresStore(key). The reason is the same in every case: a wrong value
 * here fails silently rather than loudly. Defaulting to 'tetris' would mean a
 * new game that forgot to pass an id quietly files its scores under Tetris and
 * merges two leaderboards, with nothing on screen to say so.
 */

/*
 * The client is imported, not created here. It used to call createClient at the
 * top of this file; auth.js needs the same client, and a second createClient
 * would give it a separate auth state — so a player signed in through auth.js
 * would submit scores through a client that has no session and no Authorization
 * header, i.e. anonymously, with nothing on screen to say so. See client.js.
 */
import { supabase } from './client.js';
import { capPerPlayer, MAX_PER_PLAYER, BOARD_SIZE, FETCH_LIMIT } from './topScores.js';

function requireGameId(gameId, fnName) {
  if (typeof gameId !== 'string' || gameId === '') {
    throw new Error(`${fnName} requires a gameId, e.g. 'tetris'`);
  }
}

/**
 * Top 10 for one game, highest first, with each name capped at three rows.
 *
 * The cap is why this asks for a hundred rows to return ten: the filtering is
 * done here, in capPerPlayer, so the query has to see every row that could
 * qualify. FETCH_LIMIT is the prune retention, i.e. the whole table for this
 * game, which makes the result exact. See topScores.js for why the rule lives
 * on the read path instead of in the prune function.
 *
 * Throws on failure rather than returning []. Swallowing the error made a
 * broken query indistinguishable from an empty leaderboard, so the UI cheerily
 * reported "No global scores yet" over a table with thousands of rows in it —
 * a silent network failure dressed up as a fact. Both callers already have a
 * .catch that renders a proper error state; this is what lets it run.
 *
 * `is_verified` marks a row submitted by a signed-in account, so the UI can
 * distinguish a claimed name from a typed-in one.
 *
 * ORDERING HAZARD, and it is the same one the game_id column had: this column
 * must EXIST before this select ships. PostgREST answers an unknown column with
 * Postgres 42703, the query errors, and because this function throws rather than
 * returning [], the global leaderboard on all three games fails outright — not
 * degraded, gone. Unlike game_id there is no DEFAULT that makes the reverse
 * order survivable, because the problem is on the read side. Migration first,
 * then this client. Never the other way round.
 */
export async function fetchTopScores(gameId) {
  requireGameId(gameId, 'fetchTopScores');

  const { data, error } = await supabase
    .from('leaderboard')
    .select('player_name, score, session_duration_seconds, created_at, is_verified')
    .eq('game_id', gameId)
    .order('score', { ascending: false })
    // Deterministic tie-break, earliest first — the same one
    // prune_leaderboard uses. Without it the planner decides which of two equal
    // scores comes first, and the per-player cap turns that into a row
    // appearing and disappearing between reloads rather than a harmless swap.
    .order('created_at', { ascending: true })
    .limit(FETCH_LIMIT);

  if (error) {
    console.error('Error fetching global leaderboard:', error);
    throw error;
  }
  return capPerPlayer(data, MAX_PER_PLAYER, BOARD_SIZE);
}

/**
 * Submits through the Edge Function, which holds the service-role key and is
 * the only thing allowed to write. Re-throws so the caller can show a failure
 * rather than reporting a silent success.
 */
export async function submitScore(gameId, playerName, score, sessionDurationSeconds) {
  requireGameId(gameId, 'submitScore');

  const { data, error } = await supabase.functions.invoke('submit-score', {
    body: {
      game_id: gameId,
      player_name: playerName,
      score: score,
      session_duration_seconds: sessionDurationSeconds
    }
  });

  if (error) {
    console.error('Error submitting score to edge function:', error);
    throw error;
  }

  return data;
}
