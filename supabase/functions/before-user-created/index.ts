/**
 * before-user-created — a Supabase AUTH HOOK, not an ordinary Edge Function.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * `auth.signUp` is a PUBLIC endpoint. Anything the browser checks before
 * calling it — the client-side validator in js/shared/net/auth.js, the sign-up
 * form, all of it — is skippable by POSTing to /auth/v1/signup directly with a
 * gamer tag of your choosing. There is exactly one place a gamer-tag rule can
 * be enforced unbypassably and still produce a readable error, and this is it:
 * the hook fires INSIDE the signup transaction, before the auth.users row is
 * committed, and its rejection message is surfaced to the caller.
 *
 * HOW IT RELATES TO THE DATABASE TRIGGER
 * --------------------------------------
 * public.handle_new_user() (20260731000000_accounts.sql) is the BACKSTOP, not a
 * duplicate of this. It runs after the auth.users insert, in the same
 * transaction, and its unique-violation on gamer_tag_key is what makes losing a
 * signup race safe — the whole transaction rolls back, so there is never an
 * auth.users row without a profile. But GoTrue does not surface that
 * constraint's message; the player sees "Database error saving new user" and
 * has no idea their chosen name was taken.
 *
 * This hook is the FRIENDLY path: it says "That gamer tag is already taken."
 * in plain language. Its uniqueness check is racy by construction (nothing
 * stops a second claim landing between the SELECT here and the INSERT there),
 * and that is fine precisely because the trigger catches the loser. Both are
 * needed; neither replaces the other. Do not delete either one.
 *
 * DEPLOYMENT REQUIREMENT — JWT VERIFICATION MUST BE DISABLED
 * ----------------------------------------------------------
 * Supabase Auth calls this function itself, server-to-server. There is no
 * signed-in client and therefore no user JWT on the request; with the default
 * `verify_jwt = true` the platform rejects the call before this code runs and
 * EVERY signup fails. Deploy with JWT verification off:
 *
 *   supabase/config.toml
 *     [functions.before-user-created]
 *     verify_jwt = false
 *
 *     [auth.hook.before_user_created]
 *     enabled = true
 *     uri = "https://<project-ref>.supabase.co/functions/v1/before-user-created"
 *
 *   Dashboard: Edge Functions -> before-user-created -> "Verify JWT" OFF, and
 *   Authentication -> Hooks -> Before User Created -> point at this function.
 *
 * Turning JWT verification off is NOT a hole here: the StandardWebhooks
 * signature below is what authenticates the caller, and it is stronger than a
 * shared anon key would be — it covers the body, not just the connection.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { validateGamerTag } from '../_shared/gamerTag.js'

/**
 * Player-facing messages. Every one of these is shown VERBATIM by signUp(), so
 * they are complete sentences and say what to do next — the same contract the
 * `reason` strings in _shared/gamerTag.js hold themselves to.
 */
const MISSING_TAG =
  'Please choose a gamer tag before creating your account.'
const TAKEN =
  'That gamer tag is already taken. Please choose another one.'
const UNAVAILABLE =
  'Sign-up is temporarily unavailable. Please try again later.'

/** Rejections are logged with the payload, never silently dropped. */
function logRejection(reason: string, detail: Record<string, unknown> = {}) {
  console.error('signup rejected', { reason, ...detail })
}

/**
 * The rejection wire format, verified against Supabase's Before User Created
 * Hook documentation:
 *
 *   { "error": { "http_code": 400, "message": "..." } }   with a 4xx status
 *
 * `message` is what the player reads, so it must be the sentence from
 * validateGamerTag and nothing else — no error codes, no "Error:" prefix, no
 * internal detail.
 */
function reject(message: string, req: Request, httpCode = 400): Response {
  return jsonResponse({ error: { http_code: httpCode, message } }, httpCode, req)
}

/**
 * The acceptance wire format: HTTP 200 with an EMPTY OBJECT body. Not `null`,
 * not an empty body, not the user echoed back — `{}`. Anything else risks being
 * parsed as a malformed rejection.
 */
function accept(req: Request): Response {
  return jsonResponse({}, 200, req)
}

serve(async (req) => {
  // CORS preflight answered before any other logic, per project standards.
  //
  // A hook is called server-to-server and no browser will ever preflight it, so
  // this branch is dead code in practice. It is here because the house rule is
  // unconditional and a function that is the sole exception is the one someone
  // copies as a template later.
  const preflight = handleOptions(req)
  if (preflight) return preflight

  // ---------------------------------------------------------------------
  // 1. Signature verification. FAIL CLOSED.
  // ---------------------------------------------------------------------
  //
  // The hook secret is `v1,whsec_<base64>` from the dashboard. The
  // StandardWebhooks library wants the bare base64, hence the strip.
  //
  // FAILING CLOSED IS THE DELIBERATE CHOICE, and it has a real cost: if the
  // secret is unset, wrong, or rotated in the dashboard without updating the
  // function's env, EVERY signup on the site stops working until it is fixed.
  // That is loud, immediate and obvious.
  //
  // The alternative — treat a missing secret as "skip verification" and carry
  // on — is silent, and it converts this endpoint into an unauthenticated one
  // that any caller can hit. Worse, it fails OPEN in exactly the situation
  // where nobody is looking (a misconfigured deploy), and nothing on screen
  // would say so. A broken signup form gets reported within minutes; an
  // unauthenticated hook does not get reported at all.
  //
  // Read the body as TEXT, not json(): the signature is computed over the raw
  // bytes, so re-serialising a parsed object would change key order/whitespace
  // and never verify.
  const rawSecret = Deno.env.get('BEFORE_USER_CREATED_HOOK_SECRET')

  if (!rawSecret) {
    logRejection('BEFORE_USER_CREATED_HOOK_SECRET is not set', {
      hint: 'Set it from Authentication -> Hooks. Until then all signups are refused, by design.',
    })
    return reject(UNAVAILABLE, req, 500)
  }

  let body: string
  try {
    body = await req.text()
  } catch (error) {
    logRejection('could not read request body', { error: String(error) })
    return reject(UNAVAILABLE, req, 400)
  }

  let user: Record<string, unknown>
  try {
    const wh = new Webhook(rawSecret.replace('v1,whsec_', ''))
    // verify() both checks the signature and returns the parsed payload, so
    // there is no path here on which unverified JSON gets used.
    const payload = wh.verify(body, Object.fromEntries(req.headers)) as {
      user?: Record<string, unknown>
    }
    if (!payload || typeof payload.user !== 'object' || payload.user === null) {
      throw new Error('verified payload has no user object')
    }
    user = payload.user
  } catch (error) {
    // The body is logged because CLAUDE.md requires rejections to carry their
    // payload. It contains an email address and no credential — GoTrue never
    // puts the password in the hook payload.
    logRejection('webhook signature verification failed', {
      error: String(error),
      payload: body,
    })
    return reject(UNAVAILABLE, req, 401)
  }

  // ---------------------------------------------------------------------
  // 2. The gamer tag must be present.
  // ---------------------------------------------------------------------
  //
  // js/shared/net/auth.js passes it as signUp({ options: { data: { gamer_tag } } }),
  // which lands here as user.user_metadata.gamer_tag and in the database as
  // raw_user_meta_data->>'gamer_tag'. Same single source, two readers.
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
  const rawTag = metadata.gamer_tag

  if (typeof rawTag !== 'string' || rawTag.trim() === '') {
    logRejection('gamer_tag missing from user_metadata', {
      email: user.email,
      user_metadata: metadata,
    })
    return reject(MISSING_TAG, req)
  }

  // ---------------------------------------------------------------------
  // 3. Shape, reserved words and the blocklist.
  // ---------------------------------------------------------------------
  //
  // Imported from _shared/gamerTag.js, never reimplemented. That file is loaded
  // unchanged by three runtimes (Deno here, Node in test/run-node.mjs, the
  // browser in test/index.html) precisely so this rule cannot drift between
  // what the sign-up form previews and what the server enforces.
  const validated = validateGamerTag(rawTag)

  if (!validated.ok) {
    logRejection('gamer tag failed validation', {
      email: user.email,
      gamer_tag: rawTag,
      detail: validated.reason,
    })
    // validated.reason is already a complete player-facing sentence.
    return reject(validated.reason, req)
  }

  // ---------------------------------------------------------------------
  // 4. Uniqueness, on the KEY.
  // ---------------------------------------------------------------------
  //
  // validated.key is normalizeKey(tag): lower-cased with `_` and `-` removed,
  // the same expression the profiles table's UNIQUE column is built from
  // (lower(translate(tag, '_-', ''))). Checking the display form instead would
  // let "Rick_Dangerous" and "rickdangerous" both register and be
  // indistinguishable on the leaderboard — the impersonation the key exists to
  // prevent.
  //
  // SERVICE-ROLE CLIENT. Two reasons, both load-bearing:
  //   * There is no session at signup time; the caller is GoTrue, not a user.
  //   * `banned_at`/`ban_reason` are not granted to anon, and the accounts
  //     migration replaced the blanket table grant with a COLUMN list — so
  //     `select('*')` is now 42501 "permission denied for table profiles", as
  //     is filtering or ordering on a column without SELECT on it. The column
  //     is named explicitly below for that reason; service_role has full
  //     access, but naming it keeps this query correct if the client ever
  //     changes.
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!serviceKey) {
    logRejection('SUPABASE_SERVICE_ROLE_KEY is not set', { email: user.email })
    // Fail closed again: without the key the uniqueness check cannot run, and
    // letting the signup through unchecked would hand the collision to the
    // database trigger, whose error message is the unreadable one.
    return reject(UNAVAILABLE, req, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: existing, error } = await supabase
    .from('profiles')
    .select('gamer_tag_key')
    .eq('gamer_tag_key', validated.key)
    .maybeSingle()

  if (error) {
    logRejection('uniqueness lookup failed', {
      email: user.email,
      gamer_tag: validated.tag,
      error: error.message,
    })
    // A failed lookup is NOT an implicit pass. Same reasoning as above: the
    // database trigger would still refuse a genuine duplicate, but the player
    // would get the unreadable GoTrue error instead of this sentence.
    return reject(UNAVAILABLE, req, 500)
  }

  if (existing) {
    logRejection('gamer tag already taken', {
      email: user.email,
      gamer_tag: validated.tag,
      gamer_tag_key: validated.key,
    })
    return reject(TAKEN, req)
  }

  // Accepted. The signup transaction continues; handle_new_user() will insert
  // the profiles row from the same raw_user_meta_data.gamer_tag this function
  // just validated.
  //
  // NOT NORMALISED HERE, ON PURPOSE: this hook cannot rewrite the payload, so
  // whatever the client sent is what the trigger stores. validateGamerTag only
  // trims, and the trigger trims nothing — meaning a tag sent with surrounding
  // whitespace is stored with it. The character-set rule rejects whitespace
  // anywhere inside a tag, so the only reachable case is leading/trailing
  // space, and the key derivation is unaffected. Left as-is rather than papered
  // over; if it ever matters, the fix belongs in the trigger's INSERT, not here.
  return accept(req)
})
