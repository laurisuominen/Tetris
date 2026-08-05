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
 * Pull the server's own wording out of a failed `functions.invoke`.
 *
 * supabase-js does not do this for you. A non-2xx from an Edge Function becomes
 * a FunctionsHttpError whose `.message` is the fixed string "Edge Function
 * returned a non-2xx status code" — the response body, where report-name puts
 * the sentence it wrote for the player, hangs off `.context` as an unread
 * Response. So every distinct failure arrived at the UI identical: "you must be
 * signed in", "you cannot report yourself" and "the reason is too long" were
 * all rendered as one generic apology.
 *
 * Returns '' when there is nothing usable, so the caller keeps its own fallback
 * rather than showing an empty error.
 */
async function serverMessage(error) {
  const response = error?.context;
  if (!response || typeof response.json !== 'function') return '';
  try {
    const body = await response.json();
    return typeof body?.error === 'string' ? body.error.trim() : '';
  } catch {
    // A body that is not JSON, or one already consumed. Not worth reporting —
    // the caller still has a message to show.
    return '';
  }
}

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
    const message = await serverMessage(error);
    if (!message) throw error;
    // Re-thrown as a plain Error carrying the server's sentence, with the
    // original kept on `.cause` so nothing is lost for debugging.
    throw new Error(message, { cause: error });
  }
}
