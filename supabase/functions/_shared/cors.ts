/**
 * CORS headers for every Edge Function in this project.
 *
 * WHY THIS FILE EXISTS RATHER THAN AN SDK IMPORT
 * ----------------------------------------------
 * CLAUDE.md says: on @supabase/supabase-js v2.95.0+ import `corsHeaders` from
 * the SDK, and below that define them in `functions/_shared/cors.ts`. The
 * deployed functions pin `@supabase/supabase-js@2` (a floating major), so the
 * resolved version is whatever esm.sh serves at deploy time — which is not a
 * fact this file can assert. `submit-score/index.ts` hand-rolls the same
 * constant for the same reason. This is that hand-rolled version, hoisted to
 * one place so the three account functions cannot drift apart.
 *
 * WHY THE ORIGIN IS STILL '*'
 * ---------------------------
 * CLAUDE.md: "Lock Access-Control-Allow-Origin to real origins in production.
 * `*` is dev-only. The deployed function currently uses `*`." Changing it is a
 * behaviour change to a live, already-deployed surface, so it is exposed as a
 * ONE-LINE switch (ALLOW_ANY_ORIGIN below) rather than flipped here. Flip it,
 * redeploy, done — no other edit anywhere.
 *
 * Note the site is served from three origins in practice: the production
 * domain in CNAME, and the two loopback forms `python3 -m http.server 8000`
 * produces. supabase/config.toml already allow-lists exactly those for auth
 * redirects; ALLOWED_ORIGINS below mirrors that list so the two cannot
 * disagree.
 */

/**
 * THE SWITCH. `true` = permissive `*` (current deployed behaviour, dev-safe).
 * `false` = reflect only an origin in ALLOWED_ORIGINS.
 *
 * Setting this to `false` is the whole production hardening step. Nothing else
 * needs to change.
 */
const ALLOW_ANY_ORIGIN = true

/**
 * Real origins, in preference order. Index 0 is the production domain and is
 * also the fallback value sent to an origin that is NOT on this list.
 *
 * Sending a mismatched origin rather than omitting the header is deliberate:
 * the browser then blocks the response (origin mismatch) while the response
 * still CARRIES CORS headers, so an error body is readable by anything that is
 * not a browser — curl, a test harness, the function logs. Omitting the header
 * entirely makes every failure look identical and opaque, which is the exact
 * trap CLAUDE.md warns about on the error path.
 */
const ALLOWED_ORIGINS = [
  'https://aihealgenius.com',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]

/**
 * `Access-Control-Allow-Methods` — which submit-score/index.ts OMITS.
 *
 * That omission is not currently a bug, and it is worth writing down so nobody
 * "fixes" it in a panic or copies it as a pattern. Per the Fetch standard,
 * GET, HEAD and POST are CORS-safelisted methods and are allowed by a preflight
 * whether or not they appear in this header (MDN, Access-Control-Allow-Methods:
 * "GET, HEAD, and POST are always allowed, regardless of whether they are
 * specified in this header"). submit-score is POST-only, so its preflight
 * passes regardless.
 *
 * It is stated explicitly here anyway, because that safety net covers exactly
 * three methods. The first function that needs DELETE or PATCH would fail its
 * preflight with a CORS error that says nothing about methods, and the cost of
 * pre-empting that is one header.
 */
const ALLOW_METHODS = 'POST, OPTIONS'

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type'

/**
 * Headers for a specific request. Pass the Request so the allow-list mode can
 * see the caller's Origin; omit it for a static header set.
 */
export function corsHeadersFor(req?: Request): Record<string, string> {
  if (ALLOW_ANY_ORIGIN) {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': ALLOW_HEADERS,
      'Access-Control-Allow-Methods': ALLOW_METHODS,
    }
  }

  const origin = req?.headers.get('origin') ?? ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    // Required once the value varies by request: without it a shared cache can
    // serve one origin's allow-header to another origin and the block looks
    // random. Absent in the '*' branch above because nothing varies there.
    'Vary': 'Origin',
  }
}

/**
 * The static set, for spreading into a Response when the Request is not to
 * hand. Matches the shape submit-score/index.ts already spreads.
 *
 * In allow-list mode this pins the production origin, because it is evaluated
 * once at module load with no Request. Prefer `corsHeadersFor(req)` in new
 * code; this export exists so the existing `{ ...corsHeaders }` idiom keeps
 * working.
 */
export const corsHeaders: Record<string, string> = corsHeadersFor()

/**
 * Answer the CORS preflight.
 *
 * CLAUDE.md requires OPTIONS to be answered with a 200 BEFORE any other logic —
 * before auth, before body parsing, before anything that can throw. Returns
 * `null` for every other method so the caller reads as:
 *
 *     const preflight = handleOptions(req)
 *     if (preflight) return preflight
 *
 * @returns a 200 Response for OPTIONS, otherwise null.
 */
export function handleOptions(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null
  return new Response('ok', { status: 200, headers: corsHeadersFor(req) })
}

/**
 * JSON response with CORS headers attached, for BOTH success and error paths.
 *
 * Every function below routes through this rather than constructing Responses
 * by hand, because the failure mode CLAUDE.md calls out — "an error response
 * without CORS headers is opaque to the client" — is a mistake of omission on
 * the path that is hardest to test.
 */
export function jsonResponse(
  body: unknown,
  status: number,
  req?: Request,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json' },
  })
}
