-- Create the leaderboard table
CREATE TABLE public.leaderboard (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name text NOT NULL,
  score integer NOT NULL,
  session_duration_seconds integer NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.leaderboard ENABLE ROW LEVEL SECURITY;

-- Allow public read access to the leaderboard
CREATE POLICY "Allow public read access to leaderboard"
  ON public.leaderboard
  FOR SELECT
  TO public
  USING (true);

-- Explicitly DO NOT create an INSERT policy for the 'public' (anon) role.
-- Inserts will only be allowed via the Service Role Key within the Edge Function.
