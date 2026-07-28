import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
}

// A session longer than a day is not a session; it is a tab left open, or a
// forged payload. Rejecting the absurdly long end matters because duration is
// the denominator of the points-per-second check -- inflate it enough and any
// score passes.
const MAX_SESSION_SECONDS = 86_400

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

    // 1. Schema and type. Non-integers, NaN and negatives die here, before any
    //    arithmetic is done on them -- NaN silently passes every comparison
    //    below, so an untyped score would sail through the rate check.
    const limits = typeof game_id === 'string' ? GAMES[game_id] : undefined
    if (!limits) {
      throw reject('Invalid game', payload)
    }

    if (typeof player_name !== 'string' || player_name.trim() === '' || player_name.length > 15) {
      throw reject('Invalid player name', payload)
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

    // Initialize Supabase client with Service Role Key
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!supabaseServiceKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set in environment')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Basic XSS sanitization
    const sanitizedName = player_name.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;")

    // Insert into database
    const { data, error } = await supabase
      .from('leaderboard')
      .insert([{
        game_id,
        player_name: sanitizedName,
        score: numericScore,
        session_duration_seconds: duration
      }])
      .select()

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
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    )
  }
})
