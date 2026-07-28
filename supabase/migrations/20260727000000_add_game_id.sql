-- Give the leaderboard a game dimension.
--
-- Until now the arcade had one game, so a single global top-10 was correct.
-- Snake changes that: without a game_id, Snake and Tetris scores land in the
-- same list and are indistinguishable.
--
-- This is an additive column, NOT the LIST-partitioned table CLAUDE.md sketches
-- as the eventual shape. Partitioning would require a new table, a data copy and
-- a rename; it buys nothing at this row count, so it stays deferred. A plain
-- column plus a composite index gets the same query plan here.
--
-- No rows are deleted and no table is rewritten. Since PostgreSQL 11 a NOT NULL
-- column with a *constant* default is a catalogue-only change: existing rows
-- read the default without being touched.
ALTER TABLE public.leaderboard
  ADD COLUMN game_id text NOT NULL DEFAULT 'tetris';

-- The default is what makes this a zero-downtime migration. The Edge Function
-- deployed right now inserts (player_name, score, session_duration_seconds) and
-- knows nothing about game_id; after this runs, those inserts keep succeeding
-- and are attributed to Tetris. The function can therefore be updated and
-- deployed as a separate, independently revertable step.

-- Serves the only query the leaderboard makes: top N for one game, newest-tie
-- first. The INCLUDE columns are everything the SELECT reads, so this is an
-- index-only scan with no heap fetch.
--
-- Not CONCURRENTLY: that cannot run inside a transaction block, and migrations
-- do. The table is small enough that the brief lock is not worth the complexity.
CREATE INDEX leaderboard_game_score_idx
  ON public.leaderboard (game_id, score DESC)
  INCLUDE (player_name, created_at);

-- No CHECK constraint on game_id on purpose. The allowlist lives in the
-- submit-score Edge Function instead, so adding a third game needs a function
-- deploy rather than a schema migration. Service-role writes bypass RLS, so the
-- function is the real gate either way.
