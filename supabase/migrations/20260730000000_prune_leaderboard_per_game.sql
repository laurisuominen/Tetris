-- Retain the top 100 scores PER GAME, not the top 100 in the table.
--
-- THE BUG THIS REPLACES
--
-- A trigger created by hand in the SQL editor (never in a migration, so it did
-- not exist in this repo and `supabase db reset` would not reproduce it) ran
-- after every insert:
--
--     delete from leaderboard
--     where id not in (select id from leaderboard order by score desc limit 100);
--
-- One global ranking across every game. That is only correct while there is one
-- game. With three, the leaderboard becomes a contest between games rather than
-- between players: whichever game has been played most fills the 100 slots and
-- starves the others, and a new game's scores are deleted the moment they are
-- inserted.
--
-- Measured on production 2026-07-30, immediately before this migration:
--
--     total rows 100   tetris 84   snake 15   breakout 1
--
-- Breakout's single score (183) sat at GLOBAL RANK 100 — last place in the
-- table. The next Breakout score below it would have been deleted by the
-- trigger fired by its own insert, and the game would have looked to the player
-- exactly like a broken submission.
--
-- This does not recover anything already deleted. Rows evicted before now are
-- gone; the point of this migration is that it stops.
--
-- WHY A CTE
--
-- A window function cannot appear in WHERE, so the ranking is computed in a CTE
-- and filtered outside it.
--
-- WHY THE DELETE MATCHES ON (id, game_id)
--
-- id alone is unique today — the table is not partitioned. The full key is used
-- anyway because LIST partitioning by game_id is the documented eventual shape,
-- and under partitioning a PRIMARY KEY must include the partition key, so id
-- stops being unique on its own. Deleting on id alone would then delete the
-- wrong rows. Writing it correctly now costs nothing.
--
-- IDEMPOTENT ON PURPOSE
--
-- The trigger being replaced was applied through the dashboard, so this
-- migration may be run through the dashboard too and never recorded in
-- supabase_migrations. Every statement here tolerates being run twice.

-- 1. The rule itself, as a plain callable function.
--
--    Deliberately NOT written directly into a trigger. CLAUDE.md's standard is
--    to prune on a pg_cron schedule and never on the write path, and keeping
--    the logic in a standalone function means honouring that later is
--    scheduling this function and dropping the trigger — not rewriting the SQL
--    under time pressure.
create or replace function public.prune_leaderboard(keep integer default 100)
returns integer
language plpgsql
-- Fully-qualified names plus an empty search_path: a function invoked by a
-- service-role write should not resolve object names through a caller's path.
set search_path = ''
as $$
declare
  removed integer;
begin
  with ranked as (
    select
      id,
      game_id,
      row_number() over (
        partition by game_id
        -- created_at breaks ties deterministically, earliest first. Without a
        -- tie-break, which of two equal scores survives is whatever order the
        -- planner happened to produce, so a player could lose a place on the
        -- board to a later identical score for no visible reason.
        order by score desc, created_at asc
      ) as rn
    from public.leaderboard
  )
  delete from public.leaderboard l
  using ranked r
  where r.rn > keep
    and l.id = r.id
    and l.game_id = r.game_id;

  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.prune_leaderboard(integer) is
  'Keeps the top `keep` scores per game_id. Safe to call repeatedly; returns rows deleted.';

-- 2. A thin trigger wrapper.
create or replace function public.trim_leaderboard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.prune_leaderboard(100);
  -- A statement-level AFTER trigger's return value is ignored, and NEW is not
  -- assigned in one at all. NULL is the correct thing to return; the previous
  -- version returned NEW, which happened to work only because nothing reads it.
  return null;
end;
$$;

-- 3. Swap the trigger. Dropped before the old function so the dependency goes
--    in the right order.
drop trigger if exists trigger_keep_top_100 on public.leaderboard;
drop trigger if exists trigger_prune_leaderboard on public.leaderboard;

create trigger trigger_prune_leaderboard
after insert on public.leaderboard
for each statement
execute function public.trim_leaderboard();

-- 4. Retire the old global-ranking function so it cannot be re-attached by
--    accident. Named explicitly rather than CASCADE: a CASCADE here would
--    silently drop anything else that came to depend on it.
drop function if exists public.keep_top_100_scores();
