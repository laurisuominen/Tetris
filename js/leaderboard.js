const SUPABASE_URL = 'https://obkndxwkpodmcqumocfi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_NkoT-M7MMf5VAKLGPcLOQg_sGznD-bF';

// Initialize the Supabase client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function fetchTopScores() {
  const { data, error } = await supabase
    .from('leaderboard')
    .select('player_name, score, session_duration_seconds, created_at')
    .order('score', { ascending: false })
    .limit(10);
    
  if (error) {
    console.error('Error fetching global leaderboard:', error);
    return [];
  }
  return data;
}

export async function submitScore(playerName, score, sessionDurationSeconds) {
  const { data, error } = await supabase.functions.invoke('submit-score', {
    body: {
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
