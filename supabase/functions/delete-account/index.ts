/**
 * delete-account — permanently delete the caller's own account.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * A client cannot delete its own auth user. `auth.admin.deleteUser` requires the
 * service-role key, and the service-role key must never reach a browser, so the
 * only place the deletion can happen is inside a function. That is the same
 * argument the leaderboard makes about writes, applied to the one operation a
 * user is unambiguously entitled to perform on themselves.
 *
 * THIS FUNCTION IS WHAT MAKES A PROMISE TRUE.
 * -------------------------------------------
 * The account page tells the player they can delete their account AND their
 * email address with it. That sentence is a commitment, and this function is
 * the only thing that honours it. So the deletion here is a HARD delete of the
 * auth.users row — not a flag, not a soft delete, not a "deactivated" state
 * with the address still sitting in the table. `shouldSoftDelete` is passed
 * explicitly as `false` below for exactly that reason: the default is already
 * false, but a promise about someone's email address should not depend on a
 * default that a future SDK version could flip. If that argument is ever
 * changed to `true`, the page's claim becomes false and must be reworded in the
 * same commit.
 *
 * WHAT SURVIVES THE DELETION, AND WHY THAT IS DELIBERATE
 * ------------------------------------------------------
 * Both consequences below are non-obvious from the call site, so they are
 * written here rather than discovered later from a support ticket. Both follow
 * from foreign keys in 20260731000000_accounts.sql, not from anything this
 * function does.
 *
 * 1. THE PROFILE GOES. THE SCORES STAY.
 *
 *    `public.profiles.id` references auth.users ON DELETE CASCADE, so the
 *    profile row — gamer tag, key, ban state — disappears with the account, and
 *    the tag becomes claimable again. `public.name_reports.profile_id`
 *    cascades from the profile in turn, so reports ABOUT this person are
 *    removed too, while reports this person FILED survive with reporter_id set
 *    to NULL (that FK is ON DELETE SET NULL) — a moderation queue should not
 *    empty itself because the reporter left.
 *
 *    `public.leaderboard.user_id`, however, is ON DELETE SET NULL. The scores
 *    REMAIN on the board; they simply lose their account link. That is the
 *    intended behaviour and not an oversight: deleting an account must not
 *    silently rewrite the leaderboard, because other players' ranks are defined
 *    relative to those rows and a deletion that reshuffled the board would let
 *    anyone edit history by signing up, scoring, and leaving. The score keeps
 *    the name it was submitted under because `player_name` is DENORMALISED —
 *    it is free text captured at submission, never a join to profiles — so the
 *    row reads exactly as it did before, now as an anonymous entry.
 *
 *    Worth being straight about the privacy consequence: "delete my account"
 *    removes the email address and the identity link, and it does NOT remove
 *    the gamer tag from historical score rows, because those rows never
 *    referenced the profile in the first place. If that is ever considered
 *    unacceptable, the fix is a scrub of player_name on deletion — a deliberate
 *    change with its own consequences for the board, not a quiet edit here.
 *
 * 2. THOSE SCORES LOSE THEIR VERIFIED BADGE, VIA A COLUMN NOBODY WRITES.
 *
 *    `leaderboard.is_verified` is a STORED GENERATED column —
 *    `generated always as (user_id is not null) stored`. It cannot be inserted
 *    into or updated, and it is recomputed whenever its row is updated. The
 *    foreign key's ON DELETE SET NULL *is* an update, so the moment the account
 *    goes, every one of that player's rows flips to `is_verified = false`
 *    without a single UPDATE statement appearing anywhere in this codebase.
 *
 *    That outcome is correct — the badge asserts "this score belongs to an
 *    account", and after deletion no account owns it — but it is genuinely
 *    surprising if you do not know the column is generated, and it will look
 *    like data corruption to whoever first notices verified rows turning
 *    unverified on their own. It is the schema working as designed.
 *
 * WHAT THIS FUNCTION DOES NOT DO
 * ------------------------------
 * It does not sign the caller out. The browser's session survives this call and
 * is now a token for a user that no longer exists — it will keep parsing and
 * keep failing at the Auth server. js/shared/net/auth.js documents that the
 * caller must sign out and clear the cached profile afterwards; that is the UI
 * layer's job, and doing it here is not possible anyway.
 *
 * DEPLOYMENT NOTE — JWT VERIFICATION STAYS ON
 * -------------------------------------------
 * The platform default `verify_jwt = true` is right for this function and must
 * not be turned off. It is not sufficient on its own — the publishable key in
 * page source satisfies it, so it proves the request came from this project and
 * not that a user sent it — but it is a cheap outer gate in front of the
 * `auth.getUser()` check below, which is the one that decides whose account is
 * about to be destroyed.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { handleOptions, jsonResponse } from '../_shared/cors.ts'

/** Player-facing messages. Complete sentences, shown verbatim. */
const NOT_SIGNED_IN =
  'Please sign in before deleting your account.'
const UNAVAILABLE =
  'Your account could not be deleted right now. Please try again later.'
const DELETED =
  'Your account and email address have been permanently deleted.'

/** Rejections are logged with context, never silently dropped. */
function logRejection(reason: string, detail: Record<string, unknown> = {}) {
  console.error('account deletion rejected', { reason, ...detail })
}

serve(async (req) => {
  // -----------------------------------------------------------------------
  // 0. CORS preflight, before ANY other logic.
  // -----------------------------------------------------------------------
  const preflight = handleOptions(req)
  if (preflight) return preflight

  // POST, not DELETE — despite DELETE being the verb this operation obviously
  // wants. Two reasons, both external to this file: `supabase.functions.invoke`
  // sends POST and js/shared/net/auth.js calls it with no options, and
  // `_shared/cors.ts` advertises only `POST, OPTIONS` in
  // Access-Control-Allow-Methods. Note the second one bites and the first does
  // not: per the Fetch standard POST is CORS-safelisted and passes a preflight
  // whether or not it is listed, while DELETE is not safelisted and would fail
  // preflight with an error that says nothing about methods — the exact trap
  // _shared/cors.ts documents. Switching to DELETE means editing that file
  // first, and would gain nothing but tidiness.
  if (req.method !== 'POST') {
    logRejection('method not allowed', { method: req.method })
    return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405, req)
  }

  // -----------------------------------------------------------------------
  // 1. Resolve the caller's JWT to a user id. THIS IS THE AUTHORISATION.
  // -----------------------------------------------------------------------
  //
  // The id deleted below comes from here and from nowhere else. There is no
  // user id in the request body and there must never be one — this endpoint
  // would then be "delete any account whose id you can guess", and profiles.id
  // IS the auth user id and is granted to anon, so those ids are readable by
  // anyone who can see a gamer tag. The client deliberately sends no body at
  // all (js/shared/net/auth.js), and this function deliberately reads none.
  //
  // getUser() performs a network round-trip to the Auth server instead of
  // decoding the token locally, so an expired, revoked, or already-deleted
  // user's token fails here even though it still parses as a JWT. For an
  // irreversible operation that is the only acceptable check.
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()

  if (!token) {
    logRejection('no bearer token on the request', {
      has_auth_header: authHeader !== '',
    })
    return jsonResponse({ error: NOT_SIGNED_IN }, 401, req)
  }

  if (!anonKey) {
    // Fail closed. Without the anon key the caller cannot be identified, and
    // "delete an account we could not identify" has no safe interpretation.
    logRejection('SUPABASE_ANON_KEY is not set', {
      hint: 'Set it in the function environment. Until then all deletions are refused, by design.',
    })
    return jsonResponse({ error: UNAVAILABLE }, 500, req)
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await authClient.auth.getUser(token)
  const user = userData?.user ?? null

  if (userError || !user) {
    // The token itself is never logged — it is a live credential.
    logRejection('bearer token did not resolve to a user', {
      error: userError?.message ?? 'no user on the response',
    })
    return jsonResponse({ error: NOT_SIGNED_IN }, 401, req)
  }

  // -----------------------------------------------------------------------
  // 2. Delete, with the service role.
  // -----------------------------------------------------------------------
  //
  // `auth.admin.*` is only available on a client built with the service-role
  // key; the same call on an anon client is not merely refused, the admin
  // namespace has no authority behind it. The key is read from the environment
  // and never logged, never returned, and never echoed into an error body — a
  // rejected admin call's message can be verbose and is deliberately reduced to
  // `.message` in the log line below.
  //
  // autoRefreshToken/persistSession are off because both are browser concepts:
  // a service-role client has no session to persist and no token to refresh,
  // and leaving the refresh timer on inside a short-lived function invocation
  // is a background task with nothing to do. This is the documented admin
  // client shape.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!serviceKey) {
    logRejection('SUPABASE_SERVICE_ROLE_KEY is not set', { user_id: user.id })
    return jsonResponse({ error: UNAVAILABLE }, 500, req)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // The second argument is `shouldSoftDelete`. Passed explicitly as `false`
  // even though that is the default — see the header: the account page promises
  // the email address goes with the account, and a promise about someone's
  // personal data should not rest on an SDK default. A soft delete keeps the
  // row (identifiable by hashed id) and would quietly make that promise false.
  //
  // Everything described in the header happens inside this one call, in the
  // database, via foreign keys: profiles cascades away, name_reports about this
  // profile cascade with it, reports filed by this person keep their row with
  // reporter_id NULL, leaderboard rows keep their scores with user_id NULL, and
  // is_verified recomputes to false on each of them because it is a stored
  // generated column and SET NULL is an update. No compensating writes are
  // needed here, and adding any would be a second source of truth.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id, false)

  if (deleteError) {
    logRejection('deleteUser failed', {
      user_id: user.id,
      error: deleteError.message,
    })
    // Reported as a failure rather than swallowed. The caller is about to sign
    // out and clear its cached profile on the strength of this response; if the
    // account still exists, telling the player it is gone is the one outcome
    // that must not happen.
    return jsonResponse({ error: UNAVAILABLE }, 500, req)
  }

  // Logged because this is irreversible and there is no row left to audit
  // afterwards. The id is not sensitive on its own (profiles.id is granted to
  // anon) and it is the only handle that could ever connect a support request
  // to what happened here. The email is NOT logged: deleting it and then
  // keeping a copy in the function logs would defeat the point of the call.
  console.log('account deleted', { user_id: user.id })

  return jsonResponse({ ok: true, message: DELETED }, 200, req)
})
