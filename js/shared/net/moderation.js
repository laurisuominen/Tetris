/**
 * Moderation calls.
 *
 * Separate from auth.js because reporting a name is not an authentication
 * concern — it just happens to require a session. It lives under net/ because
 * of the standing invariant: no fetch and no Supabase import outside
 * js/shared/net/.
 *
 * Everything goes through an Edge Function rather than the table. `name_reports`
 * has RLS enabled with no policy for any role, so there is no client path to it
 * at all — the service role inside the function is the only way in. That is the
 * same shape the leaderboard uses, and for the same reason: a table a client can
 * write to is a table a client can fill with garbage.
 */

import { supabase } from './client.js';

/**
 * Report a gamer tag for review.
 *
 * The server answers the same way whether or not the tag exists, so a caller
 * cannot use this to enumerate accounts — do not add a "no such player" branch
 * here on the strength of a response, because there isn't one to read.
 *
 * @param {string} gamerTag The tag being reported, as displayed.
 * @param {string} [reason] Optional free text, capped server-side at 300 chars.
 * @returns {Promise<void>} Resolves on success; throws with a usable message.
 */
export async function reportName(gamerTag, reason = '') {
  if (typeof gamerTag !== 'string' || gamerTag.trim() === '') {
    throw new Error('reportName requires a gamer tag');
  }

  const { error } = await supabase.functions.invoke('report-name', {
    body: { gamer_tag: gamerTag, reason }
  });

  if (error) {
    // Thrown rather than swallowed, for the reason leaderboard.js documents:
    // a moderation action that silently does nothing is worse than one that
    // visibly fails, because the reporter walks away believing it worked.
    console.error('Failed to report name:', error);
    throw error;
  }
}
