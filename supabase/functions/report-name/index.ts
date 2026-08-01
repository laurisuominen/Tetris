/**
 * report-name — file a moderation report against a gamer tag.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * `_shared/gamerTag.js` says it plainly in its own header: the blocklist is a
 * speed bump, not a wall. It is English-only, it is public (this repository is
 * public), and it deliberately refuses to list terms whose normalised forms
 * would eat innocent names — `kkk`, `88`, `coon` are absent ON PURPOSE. The
 * file's closing argument is that "the real remedy is the report-and-ban path".
 * This function IS that path. Without it the filter's known gaps have no
 * backstop and the honest comment in gamerTag.js becomes a lie.
 *
 * WHY IT IS AN EDGE FUNCTION AND NOT A CLIENT INSERT
 * --------------------------------------------------
 * `public.name_reports` has RLS enabled with NO POLICY FOR ANY ROLE, and no
 * privileges granted to anon or authenticated (20260731000000_accounts.sql,
 * section 2). That is two independent locks, and they make the table
 * unreachable from a browser: a signed-in client can neither read a report nor
 * file one. Only the service role — which bypasses RLS — can write it, and the
 * service-role key exists only in here. Same shape as the leaderboard: the
 * client is untrusted, so the write goes through a function that can attribute
 * it to a verified JWT rather than to whatever the caller claims to be.
 *
 * THE ORDERING THAT MATTERS, AND WHY
 * ----------------------------------
 * Authentication happens BEFORE the database is touched, and that ordering is
 * the whole security story of this function rather than a stylistic preference.
 * This endpoint takes a gamer tag and behaves differently depending on whether
 * it exists — so if an unauthenticated caller could reach the lookup, it would
 * be a free gamer-tag enumeration oracle: POST a candidate tag, watch the
 * response, learn whether someone holds it. The 401 below closes that, and the
 * neutral success at the bottom closes what remains of it for callers who DO
 * have an account. See the two comments at those points.
 *
 * DEPLOYMENT NOTE — JWT VERIFICATION STAYS ON
 * -------------------------------------------
 * Unlike before-user-created, this function is called by a browser holding a
 * session, so the platform default `verify_jwt = true` is correct and should be
 * left alone. It is NOT sufficient on its own, though: that gate proves the
 * caller presented a valid project key, and the publishable/anon key every
 * visitor already has in page source satisfies it. It proves a request came
 * from this project; it does not prove there is a USER behind it. The
 * `auth.getUser()` call below is the check that does, and it is the one this
 * function relies on.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { normalizeKey } from '../_shared/gamerTag.js'

/**
 * Player-facing messages. Complete sentences, shown as-is, saying what to do
 * next — the same contract before-user-created and _shared/gamerTag.js hold.
 */
const NOT_SIGNED_IN =
  'Please sign in before reporting a gamer tag.'
const MISSING_TAG =
  'Please say which gamer tag you are reporting.'
const BAD_REASON =
  'The reason must be text of 300 characters or fewer.'
const SELF_REPORT =
  'You cannot report your own gamer tag. If you want to change it, delete your account and sign up again.'
const UNAVAILABLE =
  'Reporting is temporarily unavailable. Please try again later.'
const THANKS =
  'Thanks. Your report has been sent to moderation.'

/**
 * The longest `reason` accepted. 300 characters is enough for "this is a slur
 * in <language>, it means <x>" — which is the report that is actually useful —
 * and short enough that the column cannot be used as free storage or as a way
 * to flood the moderation queue's readability. The column itself is unbounded
 * `text`, so this cap exists only here; it is a product decision, not a schema
 * constraint, which is why it is a constant and not a CHECK.
 */
const MAX_REASON_LENGTH = 300

/**
 * The longest `gamer_tag` accepted for LOOKUP. Note this is 100, not the 15 that
 * validateGamerTag enforces at signup, and the gap is deliberate — see the
 * comment above the lookup for why a reported tag is not run through the
 * validator at all. This bound exists purely so an unbounded string cannot be
 * shipped into a query and into the logs.
 */
const MAX_TAG_LENGTH = 100

/** Rejections are logged with their payload, never silently dropped. */
function logRejection(reason: string, detail: Record<string, unknown> = {}) {
  console.error('name report rejected', { reason, ...detail })
}

serve(async (req) => {
  // -----------------------------------------------------------------------
  // 0. CORS preflight, before ANY other logic.
  // -----------------------------------------------------------------------
  //
  // Before auth, before body parsing, before anything that can throw. A browser
  // that cannot preflight never sends the real request, so a preflight answered
  // after a check that might fail is a function nobody can call.
  const preflight = handleOptions(req)
  if (preflight) return preflight

  // POST only. `_shared/cors.ts` advertises `POST, OPTIONS` in
  // Access-Control-Allow-Methods and that file is not this task's to change, so
  // there is no browser-reachable verb other than POST. Rejecting anything else
  // explicitly beats letting a GET fall through the body parser and surface as
  // "unexpected end of JSON input", which names the wrong problem.
  if (req.method !== 'POST') {
    logRejection('method not allowed', { method: req.method })
    return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405, req)
  }

  // -----------------------------------------------------------------------
  // 1. Resolve the caller to a REAL user. BEFORE the database. FAIL CLOSED.
  // -----------------------------------------------------------------------
  //
  // This is step one and not step three on purpose. Everything below either
  // reads `profiles` or writes `name_reports`, and the read is existence-
  // sensitive: an anonymous caller allowed to reach it could walk a wordlist
  // through this endpoint and learn which gamer tags are registered. Answering
  // 401 before the first query means an unauthenticated caller learns exactly
  // one fact — that they are not signed in — which they already knew.
  //
  // Attribution is the second reason. `name_reports.reporter_id` is what makes
  // the queue actionable (who reported this, how often, are they credible) and
  // what makes rate-limiting possible at all. A report from nobody is noise.
  //
  // The client is built on the ANON key with the caller's Authorization header
  // attached, which is the documented Edge Function pattern, and the bearer is
  // ALSO passed explicitly to getUser(). Both, deliberately: the header is what
  // would scope any RLS-bound query made on this client (this function makes
  // none), while the explicit token is what getUser validates. getUser performs
  // a network round-trip to the Auth server rather than decoding the JWT
  // locally, so the answer is authentic and is a sound basis for authorisation
  // — an expired or revoked token fails here even though it still parses.
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
    // Fail closed, same reasoning as before-user-created's missing-secret
    // branch: without the anon key the caller cannot be authenticated, and a
    // report filed by an unauthenticated caller is worse than no report — it
    // arrives in the moderation queue with a null reporter and no way to tell
    // whether it was a person or a script.
    logRejection('SUPABASE_ANON_KEY is not set', {
      hint: 'Set it in the function environment. Until then all reports are refused, by design.',
    })
    return jsonResponse({ error: UNAVAILABLE }, 500, req)
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await authClient.auth.getUser(token)
  const reporter = userData?.user ?? null

  if (userError || !reporter) {
    // The token is NOT logged. It is a live credential for the duration of its
    // expiry, and function logs are not the place for one. The failure reason
    // is enough to debug with.
    logRejection('bearer token did not resolve to a user', {
      error: userError?.message ?? 'no user on the response',
    })
    return jsonResponse({ error: NOT_SIGNED_IN }, 401, req)
  }

  // -----------------------------------------------------------------------
  // 2. Body shape. Still no database access.
  // -----------------------------------------------------------------------
  let payload: Record<string, unknown>
  try {
    payload = (await req.json()) as Record<string, unknown>
    if (!payload || typeof payload !== 'object') throw new Error('body is not an object')
  } catch (error) {
    logRejection('could not parse request body', {
      reporter_id: reporter.id,
      error: String(error),
    })
    return jsonResponse({ error: MISSING_TAG }, 400, req)
  }

  const rawTag = payload.gamer_tag
  const rawReason = payload.reason

  // A missing or malformed gamer_tag is a CLIENT BUG, not a lookup result, so
  // answering 400 here leaks nothing about who exists — the response depends
  // only on what the caller sent, never on what the database holds. That
  // distinction is what lets this branch be specific while the outcome at the
  // bottom of the function stays deliberately neutral.
  if (typeof rawTag !== 'string' || rawTag.trim() === '' || rawTag.length > MAX_TAG_LENGTH) {
    logRejection('gamer_tag missing or malformed', {
      reporter_id: reporter.id,
      payload,
    })
    return jsonResponse({ error: MISSING_TAG }, 400, req)
  }

  // `reason` is OPTIONAL — absent and null are both fine, because "this name is
  // obviously abusive" often needs no explanation and demanding one suppresses
  // reports. But if it is present it must be a string: a number or an object
  // would land in a `text` column as whatever the driver coerced it to, and a
  // moderator would read the coercion rather than the report.
  let reason: string | null = null
  if (rawReason !== undefined && rawReason !== null) {
    if (typeof rawReason !== 'string' || rawReason.length > MAX_REASON_LENGTH) {
      logRejection('reason is not a string of acceptable length', {
        reporter_id: reporter.id,
        reason_type: typeof rawReason,
        reason_length: typeof rawReason === 'string' ? rawReason.length : null,
      })
      return jsonResponse({ error: BAD_REASON }, 400, req)
    }
    const trimmed = rawReason.trim()
    // An empty or whitespace-only reason is stored as NULL rather than '' so
    // "no reason given" has exactly one representation in the queue.
    reason = trimmed === '' ? null : trimmed
  }

  // -----------------------------------------------------------------------
  // 3. Resolve the tag to a profile. SERVICE ROLE, NAMED COLUMNS.
  // -----------------------------------------------------------------------
  //
  // SERVICE ROLE because `name_reports` is unreachable any other way (see the
  // header), and because the anon grant on `profiles` covers only
  // (id, gamer_tag, created_at) — gamer_tag_key is NOT granted, and PostgreSQL
  // requires SELECT privilege on every column a query REFERENCES, not just the
  // ones it returns. Filtering on gamer_tag_key with the caller's client would
  // be 42501, not an empty result.
  //
  // NAMED COLUMNS for the same migration's other consequence: the blanket table
  // grant was replaced with a column list, `*` expands to every column, and the
  // privilege check covers all of them. `select('*')` is now an error on this
  // table. The service role is unaffected — but naming the columns keeps this
  // query correct if it is ever moved onto a different client, and it is the
  // house pattern besides.
  //
  // MATCHED ON THE KEY, VIA normalizeKey — not by lowercasing here. The key is
  // lower-cased with `_` and `-` removed, and the profiles column is the same
  // expression (lower(translate(tag, '_-', ''))). Importing the function rather
  // than reimplementing it is what guarantees a report finds the SAME row the
  // signup uniqueness check would have refused. Hand-rolling `.toLowerCase()`
  // would miss separators, so a report against "Rick_Dangerous" would silently
  // find nothing while the account plainly exists — the worst possible failure
  // for a moderation path, because it looks like success.
  //
  // NOT RUN THROUGH validateGamerTag, DELIBERATELY. A reported tag is by
  // definition one that somebody believes should not have got through, and tags
  // registered before a rule tightened do not become invalid retroactively.
  // Gating the report on current validity would make exactly the names most
  // worth reporting the ones that cannot be reported. MAX_TAG_LENGTH above is
  // the only bound applied, and it is a sanity bound, not a rule.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!serviceKey) {
    logRejection('SUPABASE_SERVICE_ROLE_KEY is not set', { reporter_id: reporter.id })
    return jsonResponse({ error: UNAVAILABLE }, 500, req)
  }

  const admin = createClient(supabaseUrl, serviceKey)

  const key = normalizeKey(rawTag)

  const { data: profile, error: lookupError } = await admin
    .from('profiles')
    .select('id, gamer_tag_key')
    .eq('gamer_tag_key', key)
    .maybeSingle()

  if (lookupError) {
    logRejection('profile lookup failed', {
      reporter_id: reporter.id,
      gamer_tag: rawTag,
      gamer_tag_key: key,
      error: lookupError.message,
    })
    return jsonResponse({ error: UNAVAILABLE }, 500, req)
  }

  // NO SUCH TAG -> THE SAME RESPONSE AS SUCCESS.
  //
  // This is the anti-enumeration decision, and it is the reason the success
  // message at the bottom is worded as an acknowledgement ("your report has
  // been sent") rather than a claim about the target. Telling an authenticated
  // caller "no such gamer tag" would turn this endpoint into a membership
  // oracle for anyone willing to create one account: POST a wordlist, sort the
  // 404s from the 200s, and you have the site's user directory keyed by name.
  // Signing up costs an email address and nothing else, so "you must be logged
  // in" is not a meaningful barrier to that.
  //
  // The cost is real and worth stating: a player who fat-fingers the tag gets a
  // thank-you for a report that was never filed. That is the accepted trade —
  // the report path is not a lookup tool, and the honest alternative (an
  // explicit "unknown tag" error) hands out the directory. The difference is
  // recorded server-side instead, where moderators can see it and nobody
  // outside can, which is what makes this a neutral response rather than a
  // silently dropped one.
  if (!profile) {
    logRejection('report names a gamer tag that does not exist', {
      reporter_id: reporter.id,
      gamer_tag: rawTag,
      gamer_tag_key: key,
      note: 'Caller received the neutral success response. Nothing was inserted.',
    })
    return jsonResponse({ ok: true, message: THANKS }, 200, req)
  }

  // -----------------------------------------------------------------------
  // 4. Self-reports.
  // -----------------------------------------------------------------------
  //
  // Refused with a specific message rather than folded into the neutral
  // response, and that is not an information leak: the only fact this branch
  // discloses is that the caller's own tag exists, which the caller chose at
  // signup and sees on their own account page.
  //
  // Worth refusing at all because a self-report is either a mistake or an
  // attempt to use the moderation queue as a rename form — and a rename form is
  // exactly what this arcade does not have, since gamer_tag_key is the
  // impersonation defence and a freely changeable tag would let one account
  // cycle through other people's names. Saying so, with the real remedy
  // (delete-account, then sign up again), is more use than silence.
  if (profile.id === reporter.id) {
    logRejection('self-report', {
      reporter_id: reporter.id,
      gamer_tag: rawTag,
    })
    return jsonResponse({ error: SELF_REPORT }, 400, req)
  }

  // -----------------------------------------------------------------------
  // 5. Duplicate reports: DEDUPED, on (profile_id, reporter_id) while OPEN.
  // -----------------------------------------------------------------------
  //
  // The decision, stated explicitly rather than left silent:
  //
  // WHAT IT DOES. If this reporter already has an UNRESOLVED report against
  // this profile, nothing is inserted and the caller gets the same neutral
  // success. Once a moderator sets `resolved_at`, the same pair can report
  // again — which is the behaviour that matters if the name was reviewed,
  // cleared, and then the tag holder does something new. Deduping on the pair
  // forever would make a recurrence unreportable by the person most likely to
  // notice it.
  //
  // WHY DEDUPE. One angry player refreshing a form can otherwise file fifty
  // rows, and a queue where row count is the only visible signal then reads as
  // fifty complaints instead of one. Deduping keeps "how many DISTINCT people
  // reported this" recoverable, which is the number a moderator actually wants.
  //
  // WHAT IT IS NOT. This is best-effort, not a guarantee, and pretending
  // otherwise would be the lie worth avoiding here. There is no unique index on
  // (profile_id, reporter_id) in 20260731000000_accounts.sql, so this is a
  // SELECT-then-INSERT with a race window: two simultaneous reports from the
  // same reporter can both find nothing and both insert. The result is a
  // duplicate row in a moderation queue — noise a human resolves in one click,
  // not corruption — so a migration adding a partial unique index was not worth
  // pulling into this change. If report volume ever makes it worth enforcing,
  // the fix is that index plus an upsert here, NOT more logic in this function.
  //
  // It is also not rate limiting. Nothing here stops one reporter filing
  // against a hundred DIFFERENT profiles, and nothing stops a hundred throwaway
  // accounts filing against one. Both are real, both need a counter this
  // function does not have, and neither is solved by pretending this check is
  // more than a de-duplicator.
  const { data: openReports, error: dupeError } = await admin
    .from('name_reports')
    .select('id')
    .eq('profile_id', profile.id)
    .eq('reporter_id', reporter.id)
    .is('resolved_at', null)
    .limit(1)

  if (dupeError) {
    // A failed duplicate check is NOT an implicit "go ahead and insert", and it
    // is not a failure to report to the player either. Refuse: an unreadable
    // queue is a moderation problem, and the caller can retry. Logged with the
    // driver's message so the cause is visible.
    logRejection('duplicate-report lookup failed', {
      reporter_id: reporter.id,
      profile_id: profile.id,
      error: dupeError.message,
    })
    return jsonResponse({ error: UNAVAILABLE }, 500, req)
  }

  if (openReports && openReports.length > 0) {
    console.log('name report deduplicated', {
      reporter_id: reporter.id,
      profile_id: profile.id,
      existing_report_id: openReports[0].id,
      note: 'Open report already exists for this pair. Nothing inserted; caller received the neutral success response.',
    })
    return jsonResponse({ ok: true, message: THANKS }, 200, req)
  }

  // -----------------------------------------------------------------------
  // 6. File it.
  // -----------------------------------------------------------------------
  //
  // reporter_id comes from the VERIFIED JWT above and never from the body. The
  // body has no reporter field and must never gain one — accepting an id from
  // the caller would make this a "file a report as anyone you can name"
  // endpoint, which is worse than an unattributed queue because the attribution
  // would look trustworthy. Same reasoning as deleteAccount() in
  // js/shared/net/auth.js, which pointedly sends no user id either.
  //
  // The remaining columns are the table's defaults: id (gen_random_uuid),
  // created_at (utc now) and resolved_at (null = open). Not written here, so
  // the schema stays the single place they are decided.
  const { error: insertError } = await admin
    .from('name_reports')
    .insert([{ profile_id: profile.id, reporter_id: reporter.id, reason }])

  if (insertError) {
    logRejection('report insert failed', {
      reporter_id: reporter.id,
      profile_id: profile.id,
      reason,
      error: insertError.message,
    })
    // Told plainly, because the player is entitled to know their report did not
    // land. CLAUDE.md's UI rule — explicit success or failure, no silent
    // network operations — outranks tidiness here, and this branch reveals
    // nothing: it fires on a database fault, not on anything about the target.
    return jsonResponse({ error: UNAVAILABLE }, 500, req)
  }

  // Accepted. Logged as well as answered: the response is deliberately the same
  // sentence a report against a non-existent tag receives, so the log is the
  // ONLY place the two outcomes are distinguishable. That asymmetry is the
  // whole design — visible inside, opaque outside.
  console.log('name report filed', {
    reporter_id: reporter.id,
    profile_id: profile.id,
    has_reason: reason !== null,
  })

  return jsonResponse({ ok: true, message: THANKS }, 200, req)
})
