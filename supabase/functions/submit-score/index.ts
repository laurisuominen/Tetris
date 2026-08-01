import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * THE ONE FLIP THAT MAKES GAMER TAGS MANDATORY.
 *
 * false  — the legacy three-initials path stays open. A player who is not
 *          signed in submits under `[A-Z0-9]{3}` and the row's user_id is NULL,
 *          so `leaderboard.is_verified` computes to false and the board renders
 *          it without the badge. This is today's behaviour and it keeps the
 *          arcade playable for someone who just wants to play.
 * true   — anonymous submissions are refused with ACCOUNT_REQUIRED and nothing
 *          reaches the table without an account behind it.
 *
 * The `true` branch is IMPLEMENTED BELOW, not planned. Flipping this constant is
 * the whole change: no other edit to this function, and no schema change either,
 * because user_id is already the only thing is_verified is derived from. Nothing
 * else in the file reads it, so there is no second place to keep in sync.
 *
 * What flipping it does NOT do: it cannot retroactively verify the anonymous
 * rows already on the board, and it does not stop the client offering the
 * initials box — js/games/<name>/ still has to be told, or the player types
 * three letters and is told no afterwards, which is exactly the "prevent errors
 * up front" rule in CLAUDE.md. Change the client in the same release.
 */
const REQUIRE_ACCOUNT = false

/**
 * Which games may write, and the ceilings each is held to.
 *
 * The allowlist lives here rather than as a CHECK constraint on the table so a
 * third game costs a function deploy instead of a schema migration. Service-role
 * writes bypass RLS, so this function is the real gate either way.
 *
 * maxPointsPerSecond and maxScore MUST be derived from the game's own engine.
 * Do not copy a number from a spec document and do not reuse another game's.
 */
const GAMES: Record<string, { maxPointsPerSecond: number; maxScore: number }> = {
  // NOT DERIVED. 5000 pts/sec is inherited from the single-game version and has
  // no derivation behind it; the max score is a placeholder well above anything
  // a human reaches. Recomputing these from the Tetris engine (grid size x tick
  // rate x max points per event) is outstanding work, deliberately not bundled
  // into the Snake change. Treat both as unverified.
  tetris: { maxPointsPerSecond: 5000, maxScore: 10_000_000 },

  // Derived from js/games/snake/core/constants.js:
  //
  //   20 x 20 grid = 400 cells, snake starts at length 3
  //     -> at most 397 apples in a theoretically perfect game
  //   apple value = 10 x speed multiplier, Rabbit multiplier is 3
  //     -> at most 30 points per apple
  //   Rabbit base interval 70ms, floored at base * 0.5 = 35ms
  //     -> at most 1000 / 35 = 28.6 moves per second
  //
  //   points/sec upper bound = 28.6 moves/s x 30 pts    = 857  -> ceiling 900
  //   total upper bound      = 397 apples x 30 pts      = 11,910 -> cap 12,000
  //
  // The points/sec bound assumes every single move eats an apple, which is
  // impossible; it is a true ceiling, not an expected value. The total bound is
  // the tighter of the two checks in practice.
  snake: { maxPointsPerSecond: 900, maxScore: 12_000 },

  // Derived from js/games/breakout/core/constants.js and scoring.js:
  //
  //   score multiplier = level, capped at SCORE_MULTIPLIER_CAP = 20
  //   top brick row is worth 7
  //     -> at most 7 x 20 = 140 points per brick
  //   MAX_BALL_SPEED = 48 cells/sec and a brick is 1 cell tall
  //     -> the ball cannot cross a brick boundary more than 48 times a second
  //
  //   points/sec upper bound = 48 hits/s x 140 pts        = 6,720 -> ceiling 7,000
  //
  //   MAX_LEVEL = 99, and a full screen is 448 points at multiplier 1
  //   total = 448 x [ (1+...+20) + 79 x 20 ]
  //         = 448 x [ 210 + 1,580 ] = 448 x 1,790         = 801,920 -> cap 810,000
  //
  // As with Snake, the points/sec bound assumes every hit lands at the maximum
  // value with no travel between them, which is impossible. It is a true
  // ceiling, not an expected value.
  breakout: { maxPointsPerSecond: 7_000, maxScore: 810_000 },
}

// A session longer than a day is not a session; it is a tab left open, or a
// forged payload. Rejecting the absurdly long end matters because duration is
// the denominator of the points-per-second check -- inflate it enough and any
// score passes.
const MAX_SESSION_SECONDS = 86_400

/**
 * The anonymous name rule: EXACTLY three characters, A-Z and 0-9 only.
 *
 * This is what the arcade cabinet convention actually is, and — more to the
 * point — it is what the client already enforces LOCALLY. js/shared/storage/
 * scoresStore.js normalises initials with
 * `.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3).padEnd(3, 'A')`, but it
 * does so on the LOCAL save path, which runs AFTER submitScore() has already
 * posted to this function. So until now the two boards disagreed about the same
 * player in the same game-over: the local table stored `ABC` while the global
 * table stored whatever was typed — any length up to 15, any Unicode, emoji,
 * combining marks, RTL overrides, homoglyph Cyrillic lookalikes. The old rule
 * here was "non-empty and length <= 15" and had no character set at all.
 *
 * Matching the local rule closes that asymmetry from the trusted end. It is
 * also the reason the `<`/`>` entity escaping that used to sit above the insert
 * is gone rather than kept as belt-and-braces: see the note at the insert.
 */
const INITIALS_PATTERN = /^[A-Z0-9]{3}$/

/**
 * A JSON Web Token is three base64url segments separated by dots.
 *
 * THIS TEST IS LOAD-BEARING, and the reason is not obvious. When the player is
 * signed OUT, supabase.functions.invoke still sends an Authorization header —
 * it falls back to the project's publishable key. This project's key is the new
 * `sb_publishable_...` format (see js/shared/net/client.js), which is NOT a JWT
 * and never resolves to a user. "Authorization header present" therefore does
 * not mean "signed in", and treating it that way would make every anonymous
 * submission take a pointless round trip to the auth server and then be
 * misreported.
 *
 * Cheap shape test first, network call only if it could possibly succeed. Note
 * a project on the LEGACY key format has an anon key that IS a JWT and does
 * pass this test; that is harmless, because it carries no `sub` claim and
 * getUser rejects it, landing on the same anonymous path one round trip later.
 */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

/** Player-facing messages. Complete sentences that say what to do next. */
const ACCOUNT_REQUIRED =
  'A free account is now required to post a score. Create one from the arcade menu, then play again.'
const ACCOUNT_BANNED =
  'This account is not allowed to post scores.'
const PROFILE_MISSING =
  'Your account has no gamer tag yet. Finish setting up your account, then try again.'
const PROFILE_UNAVAILABLE =
  'Could not read your account just now. Please try again in a moment.'
const INVALID_INITIALS =
  'Initials must be exactly three letters or numbers (A-Z, 0-9).'

/** Rejections are logged with the payload, never silently dropped. */
function reject(reason: string, payload: unknown, extra: Record<string, unknown> = {}) {
  console.error('score rejected', { reason, payload, ...extra })
  return new Error(reason)
}

serve(async (req) => {
  // CORS preflight answered before any other logic, per project standards.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let payload: unknown = null

  try {
    payload = await req.json()
    const { game_id, player_name, score, session_duration_seconds } = payload as Record<string, unknown>

    // -------------------------------------------------------------------
    // ANTI-CHEAT, IN THE ORDER CLAUDE.md MANDATES. Unchanged by the accounts
    // work: this block is about whether the NUMBERS are possible, and it runs
    // before identity is resolved so a forged payload is refused without
    // costing an auth round trip or a profile lookup.
    //
    // player_name is deliberately absent from step 1. Who the player is, and
    // therefore whether the client's name field is even read, is decided in
    // one place further down — a signed-in submission ignores that field
    // entirely, so type-checking it here would reject a payload on the
    // strength of a value that is about to be thrown away.
    // -------------------------------------------------------------------

    // 1. Schema and type. Non-integers, NaN and negatives die here, before any
    //    arithmetic is done on them -- NaN silently passes every comparison
    //    below, so an untyped score would sail through the rate check.
    const limits = typeof game_id === 'string' ? GAMES[game_id] : undefined
    if (!limits) {
      throw reject('Invalid game', payload)
    }

    if (!Number.isInteger(score) || (score as number) < 0) {
      throw reject('Invalid score', payload)
    }

    if (!Number.isInteger(session_duration_seconds) || (session_duration_seconds as number) < 0) {
      throw reject('Invalid session duration', payload)
    }

    const numericScore = score as number
    const duration = session_duration_seconds as number

    // 2. Points per second against this game's ceiling.
    const rate = duration > 0 ? numericScore / duration : Infinity
    if (numericScore > 0 && rate > limits.maxPointsPerSecond) {
      throw reject('Score rejected: impossible points per second', payload, {
        rate,
        ceiling: limits.maxPointsPerSecond,
      })
    }

    if (numericScore > limits.maxScore) {
      throw reject('Score rejected: above the maximum attainable', payload, {
        cap: limits.maxScore,
      })
    }

    // 3. Session duration bounds. Both ends are suspicious.
    //
    // NOTE: session_duration_seconds is client-supplied and trivially forged.
    // There is no signed session token yet, so these checks raise the cost of
    // cheating rather than preventing it. That gap is documented in CLAUDE.md.
    if (numericScore > 1000 && duration < 10) {
      throw reject('Score rejected: game too short', payload, { duration })
    }

    if (duration > MAX_SESSION_SECONDS) {
      throw reject('Score rejected: session too long', payload, { duration })
    }

    // Service-role client. Used for the profile lookup and the insert, and for
    // NOTHING ELSE -- in particular it is never used to decide who the caller
    // is. A client holding the service key would happily answer questions
    // about any user; identity has to come from the caller's own token, which
    // is what the separate client below is for.
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!supabaseServiceKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set in environment')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // -------------------------------------------------------------------
    // 4. IDENTITY. Who is submitting, and therefore what name goes on the row.
    //
    // A signed-in player's name comes from the DATABASE, never from the
    // request body. That is the whole point of the accounts work: if the
    // submitted name were trusted, an account holder could post under someone
    // else's gamer tag and the is_verified badge -- which the leaderboard
    // renders as "this really is that person" -- would be a lie the client
    // gets to author.
    // -------------------------------------------------------------------
    const authHeader = req.headers.get('Authorization') ?? ''
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

    let userId: string | null = null

    if (bearer && JWT_SHAPE.test(bearer)) {
      // A SECOND CLIENT, built from the caller's own token. Its only job is to
      // ask the auth server "whose token is this?". The anon/publishable key
      // is the API-gateway credential; the Authorization header is the claim
      // being checked. Passing the token to getUser() explicitly means the
      // answer comes from the auth server's signature check, not from anything
      // this function decided.
      //
      // UNVERIFIED: which of these two names the platform injects for a
      // project on the new key format. Both are read so the function is
      // correct either way, and neither being present is a loud configuration
      // error rather than a silent downgrade of every signed-in player to
      // anonymous -- that failure would be invisible, and would quietly strip
      // the badge off every score on the board.
      const gatewayKey =
        Deno.env.get('SUPABASE_ANON_KEY') ||
        Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ||
        ''

      if (!gatewayKey) {
        throw new Error(
          'Neither SUPABASE_ANON_KEY nor SUPABASE_PUBLISHABLE_KEY is set in environment; ' +
          'a signed-in submission cannot be authenticated'
        )
      }

      const callerClient = createClient(supabaseUrl, gatewayKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      })

      const { data: userData, error: userError } = await callerClient.auth.getUser(bearer)

      // NOT AN ERROR PATH. An expired token, a token from a deleted user, or
      // the legacy anon key all land here, and every one of them is simply
      // "not signed in". Refusing the submission instead would turn a stale
      // tab into a lost score for a player who never asked to be signed in.
      // It is logged, because a sudden spike in this line means token refresh
      // is broken rather than that players are signing out.
      if (userError || !userData?.user) {
        console.warn('bearer token did not resolve to a user; treating as anonymous', {
          error: userError?.message,
        })
      } else {
        userId = userData.user.id
      }
    }

    let playerName: string

    if (userId) {
      // COLUMNS ARE NAMED, AND MUST BE. 20260731000000_accounts.sql replaced
      // the blanket table grant on profiles with a column-level one, and
      // PostgreSQL expands `*` to every column and checks privilege on all of
      // them -- so select('*') is now 42501 "permission denied for table
      // profiles" rather than a quietly reduced row. service_role has full
      // access here, but naming the columns keeps this query honest about what
      // it actually needs and correct if it ever runs as something else.
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('gamer_tag, banned_at')
        .eq('id', userId)
        .maybeSingle()

      if (profileError) {
        throw reject(PROFILE_UNAVAILABLE, payload, {
          detail: 'profile lookup failed',
          user_id: userId,
          error: profileError.message,
        })
      }

      // maybeSingle(), not single(): zero rows is a real state (the signup
      // trigger failed, or an admin-created user predates it) and it deserves
      // a sentence the player can act on rather than a thrown Postgres error.
      // It is NOT quietly downgraded to the anonymous path -- a signed-in
      // player must not end up posting under three typed letters without being
      // told why.
      if (!profile) {
        throw reject(PROFILE_MISSING, payload, {
          detail: 'no profiles row for authenticated user',
          user_id: userId,
        })
      }

      if (profile.banned_at) {
        throw reject(ACCOUNT_BANNED, payload, {
          detail: 'banned account attempted a submission',
          user_id: userId,
          banned_at: profile.banned_at,
        })
      }

      // The name from the DATABASE. The client's player_name is not read on
      // this path at all, by design -- see the block comment above.
      playerName = profile.gamer_tag
    } else if (REQUIRE_ACCOUNT) {
      throw reject(ACCOUNT_REQUIRED, payload, { detail: 'anonymous submission with REQUIRE_ACCOUNT on' })
    } else {
      // Anonymous: the legacy three-initials path.
      //
      // Uppercase FIRST, then validate, so what is validated is exactly what
      // is stored -- validating the raw input and storing a transformed
      // version is how a checked string turns into an unchecked one.
      if (typeof player_name !== 'string') {
        throw reject(INVALID_INITIALS, payload, { detail: 'player_name is not a string' })
      }

      const initials = player_name.trim().toUpperCase()

      if (!INITIALS_PATTERN.test(initials)) {
        throw reject(INVALID_INITIALS, payload, { detail: 'initials failed [A-Z0-9]{3}' })
      }

      playerName = initials
    }

    // THE `<`/`>` ENTITY ESCAPING THAT USED TO BE HERE IS DELETED, deliberately.
    //
    // It replaced `<` with `&lt;` on the way INTO the database. Nothing on the
    // way out ever undid it, and every renderer in this codebase writes names
    // with textContent (CLAUDE.md forbids innerHTML outright and
    // js/shared/util/dom.js offers no markup path), which escapes again at
    // render time. So it was not protection, it was a double-escape display
    // bug: a player typing `<3` was stored as `&lt;3` and read `&lt;3` on the
    // board forever.
    //
    // What actually defends this field is the character set. An anonymous name
    // is now [A-Z0-9]{3} and a signed-in name is a gamer tag the database
    // already validated at signup -- neither can contain a bracket to escape.

    // user_id is NULL for an anonymous row and that is a real value, not a
    // missing one: leaderboard.is_verified is GENERATED ALWAYS AS (user_id is
    // not null) STORED, so this single column decides the badge.
    //
    // is_verified is NOT in this object and must never be. Writing to a
    // generated column is an error (Postgres 428C9), so adding it would not
    // produce a wrong badge -- it would break every submission outright.
    const { data, error } = await supabase
      .from('leaderboard')
      .insert([{
        game_id,
        player_name: playerName,
        score: numericScore,
        session_duration_seconds: duration,
        user_id: userId,
      }])
      // Named columns rather than a bare .select(). service_role could read
      // everything, but user_id is the one field the accounts migration
      // deliberately withholds from clients -- it is the link that turns a
      // public board into one player's cross-game history -- and echoing it
      // back in the submit response would hand it out through the side door.
      // is_verified carries the whole signal the UI needs and no identity.
      .select('id, game_id, player_name, score, session_duration_seconds, created_at, is_verified')

    if (error) {
      throw error
    }

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    )
  } catch (error) {
    // CORS headers on the error path too. Without them the browser sees an
    // opaque failure and reports a misleading CORS error instead of the reason.
    const message = error instanceof Error ? error.message : String(error)
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    )
  }
})
