import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { player_name, score, session_duration_seconds } = await req.json()

    // Validation
    if (!player_name || typeof player_name !== 'string' || player_name.trim() === '' || player_name.length > 15) {
      throw new Error('Invalid player name')
    }
    
    if (typeof score !== 'number' || score < 0) {
      throw new Error('Invalid score')
    }
    
    if (typeof session_duration_seconds !== 'number' || session_duration_seconds < 0) {
      throw new Error('Invalid session duration')
    }

    // Heuristic: Reject submissions where score > 1000 but session_duration_seconds < 10
    if (score > 1000 && session_duration_seconds < 10) {
      throw new Error('Score rejected: game too short')
    }

    // Heuristic: Max 5000 points per second.
    if (session_duration_seconds > 0 && (score / session_duration_seconds) > 5000) {
      throw new Error('Score rejected: impossible points per second')
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
        player_name: sanitizedName,
        score,
        session_duration_seconds
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
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    )
  }
})
