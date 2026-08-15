-- Achievement badges for account holders.
--
-- WHAT THIS IS FOR
--
-- A score is a single number that then decays off the board:
-- public.prune_leaderboard(100) DELETES everything outside the top 100 per game
-- on every insert, so a good run in March is gone by June. An account currently
-- buys a player a claimed gamer tag and nothing else. Badges add the layer that
-- accumulates instead of eroding.
--
-- THE MODEL IS STEAM'S, AND THE SPLIT IS THE DESIGN
--
--   public.player_stats   the counters. Progress lives here.
--   public.player_days    one row per player per UTC day they played.
--   public.player_achievements  the unlock record: binary + timestamp, no
--                               progress stored.
--
-- Badges are thresholds over the counters, evaluated in
-- supabase/functions/_shared/badges.js. Keeping progress in the stats tables
-- rather than in the unlock record is what makes a badge added in six months
-- award itself from counters that have been accumulating all along.
--
-- WHY THE COUNTERS CANNOT COME FROM public.leaderboard
--
-- Because that table is not a history. It is a top-100-per-game WINDOW behind a
-- destructive AFTER INSERT trigger (20260730000000_prune_leaderboard_per_game.sql).
-- "Played 50 games" and "100,000 lifetime points" are not derivable from it at
-- any point after the 101st row. These tables are the durable side, and nothing
-- prunes them — prune_leaderboard touches public.leaderboard and only that
-- table. Do not "tidy" it into these.
--
-- THE PRIVACY LINE, WHICH IS THE PART THAT IS EASY TO GET WRONG
--
-- 20260731000000_accounts.sql deliberately withholds leaderboard.user_id from
-- clients, because it is the join key that would let anyone assemble one
-- player's complete cross-game history from a single query. player_stats IS
-- that cross-game history. So it is NOT client-readable at all, by anyone,
-- including its owner: RLS on with no policies and no grants to anon or
-- authenticated, which is the same two-lock shape public.name_reports already
-- uses. Only the service role — i.e. an Edge Function — can read or write it.
--
-- player_achievements IS publicly readable, and that is not a contradiction.
-- profiles.id and profiles.gamer_tag are both already granted, so tag -> id is
-- already public; what stays withheld is the board-row -> user link, and
-- nothing here grants it. "This tag has the Cabinet Fixture badge" is the
-- intended public fact — it is rendered next to the name on the leaderboard.
--
-- NO BACKFILL, DELIBERATELY. Everyone starts empty. A backfill could only see
-- the surviving top-100 rows, so two players with identical histories would earn
-- different badges depending on whether their old scores had been pruned yet.
--
-- IDEMPOTENT ON PURPOSE
--
-- Like the two migrations before it, this may be applied by hand through the
-- dashboard and therefore never recorded in supabase_migrations. Every statement
-- tolerates being run twice.


-- ---------------------------------------------------------------------------
-- 1. player_stats — the counters, one row per (player, game)
-- ---------------------------------------------------------------------------
--
-- References public.profiles rather than auth.users so the cascade chain is a
-- single hop from the row a player can see. ON DELETE CASCADE, not SET NULL:
-- unlike a score, a counter belongs to nobody once the account is gone, and
-- leaving orphaned rows keyed by a dead uuid would be a privacy leak with no
-- upside. Note the contrast with leaderboard.user_id, which is SET NULL
-- precisely because deleting an account must not silently rewrite the board.
create table if not exists public.player_stats (
  user_id         uuid not null references public.profiles (id) on delete cascade,
  game_id         text not null,
  plays           integer not null default 0,
  best_score      integer not null default 0,
  -- bigint: 200 plays of Tetris at six figures each overflows nothing, but the
  -- column is a lifetime sum with no ceiling and integer's 2.1 billion is a
  -- reachable number for a determined player. The cost of bigint here is zero.
  total_score     bigint  not null default 0,
  first_played_at timestamptz not null default timezone('utc', now()),
  last_played_at  timestamptz not null default timezone('utc', now()),
  primary key (user_id, game_id)
);

comment on table public.player_stats is
  'Durable per-(player, game) counters. Service-role only — this is the cross-game history that leaderboard.user_id is withheld to prevent assembling. Not pruned.';

alter table public.player_stats enable row level security;

-- Deliberately NO policy, for any role, and no grant to anon or authenticated.
-- See the header. Two locks rather than one, matching public.name_reports.
revoke all privileges on table public.player_stats from anon, authenticated;
grant all on table public.player_stats to postgres, service_role;


-- ---------------------------------------------------------------------------
-- 2. player_days — the distinct-day log
-- ---------------------------------------------------------------------------
--
-- WHY A TABLE AND NOT A COUNTER COLUMN.
--
-- The "played on N different days" badges are arcade-wide, not per-game. A
-- distinct_days counter on player_stats is per (player, game), and summing it
-- across games double-counts a day on which someone played two games — so it
-- would award the 7-day badge to a player who came back four times. One row per
-- (player, day) makes the count exact by construction and cannot drift.
--
-- THE DAY IS A UTC DATE, WRITTEN DOWN RATHER THAN IMPLIED. Timezone-naive
-- streak aggregation is the classic achievement bug: with a local date the same
-- player crossing a timezone earns a day they did not play, and with a
-- server-local date the boundary moves twice a year. UTC is arbitrary but it is
-- fixed, and it is the same clock timezone('utc', now()) stamps every other
-- timestamp in this schema with. A player near the dateline sees their "day"
-- roll over at an odd local hour; that is the accepted cost.
create table if not exists public.player_days (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  played_on date not null,
  primary key (user_id, played_on)
);

comment on table public.player_days is
  'One row per player per UTC date on which they submitted a score. Service-role only. The exact source for the distinct-day badges; a per-game counter would double-count.';

alter table public.player_days enable row level security;

revoke all privileges on table public.player_days from anon, authenticated;
grant all on table public.player_days to postgres, service_role;


-- ---------------------------------------------------------------------------
-- 3. player_achievements — the unlock record, and the public one
-- ---------------------------------------------------------------------------
--
-- The primary key IS the idempotency guarantee. Awarding is
-- `insert ... on conflict do nothing returning achievement_key`, so a retried
-- submission, a double-tapped Save button and two tabs racing all converge on
-- one row and one announcement. There is no separate unique index because the
-- composite primary key already is one.
--
-- achievement_key is free text with no foreign key to a catalogue table, and
-- that is a choice: the catalogue lives in
-- supabase/functions/_shared/badges.js so that Deno, Node and the browser load
-- the same definition with no build step (the gamerTag.js precedent). A
-- catalogue TABLE would be a second source of truth that has to be migrated in
-- lockstep with a deploy, and the failure mode — a badge the function awards but
-- the table does not know — would be a foreign-key violation that fails a
-- player's whole submission. A key the client cannot render is instead simply
-- not rendered.
create table if not exists public.player_achievements (
  user_id         uuid not null references public.profiles (id) on delete cascade,
  achievement_key text not null,
  earned_at       timestamptz not null default timezone('utc', now()),
  primary key (user_id, achievement_key)
);

comment on table public.player_achievements is
  'Unlock record: one row per (player, badge). Publicly readable — it renders next to a gamer tag. achievement_key is defined in supabase/functions/_shared/badges.js, not in a table.';

alter table public.player_achievements enable row level security;

-- Public read, matching profiles: the leaderboard has to mark a name for a
-- visitor who is not signed in.
drop policy if exists "Allow public read access to player achievements" on public.player_achievements;
create policy "Allow public read access to player achievements"
  on public.player_achievements
  for select
  to public
  using (true);

-- No INSERT/UPDATE/DELETE policy for anon or authenticated. Clients never write
-- to the database directly; the Edge Function holding the service-role key is
-- the only way a badge is awarded. Without that, a badge would be a claim the
-- client gets to author, which is the same defect is_verified exists to avoid.

-- COLUMN-LEVEL GRANT, for consistency with the two tables it is read alongside
-- rather than because a column here is sensitive — all three are public. Naming
-- them keeps the habit intact, and it means a column added later is private by
-- default instead of public by accident. Remember the consequence the accounts
-- migration documents: `select=*` on this table is now 42501, not a filtered
-- result. Name your columns.
revoke all privileges on table public.player_achievements from anon, authenticated;
grant select (user_id, achievement_key, earned_at)
  on table public.player_achievements to anon, authenticated;
grant all on table public.player_achievements to postgres, service_role;

-- The board renders marks for up to ten names at once, i.e.
-- `where user_id in (...)`, which the primary key's leading column already
-- serves. No extra index.


-- ---------------------------------------------------------------------------
-- 4. record_play — one round trip, atomic
-- ---------------------------------------------------------------------------
--
-- Everything the badge evaluator needs, computed and returned in a single call:
-- the counters are updated and the resulting totals come back with them. Doing
-- this as four separate statements from the Edge Function would be four round
-- trips and a window in which a concurrent submission interleaves.
--
-- SECURITY INVOKER, NOT DEFINER, and that is a deliberate downgrade from the
-- obvious choice. The only caller is submit-score, which holds the service-role
-- key and already has `grant all` on all three tables, so DEFINER would buy
-- nothing and would make this function a standing privilege escalation for
-- anyone who found a way to call it. prune_leaderboard is invoker for the same
-- reason. EXECUTE is revoked from PUBLIC below so the question does not arise.
--
-- `set search_path = ''` with every name schema-qualified, matching the other
-- two functions in this schema.
create or replace function public.record_play(
  p_user_id uuid,
  p_game_id text,
  p_score   integer
)
-- OUT PARAMETER NAMES ARE CHOSEN NOT TO COLLIDE WITH COLUMN NAMES, and that is
-- not cosmetic. Inside plpgsql an OUT parameter is a variable in scope for every
-- statement in the body, and an unqualified identifier that matches one is
-- substituted for the variable rather than resolved as a column. `game_best`
-- rather than `best_score` means there is no identifier in this function that
-- could be read two ways — every reference below is table-qualified as well, so
-- the two defences are independent.
returns table (
  plays_total   integer,
  games_played  text[],
  game_best     integer,
  distinct_days integer,
  earned_keys   text[]
)
language plpgsql
set search_path = ''
as $$
declare
  -- now(), NOT timezone('utc', now()), for the timestamptz columns.
  --
  -- timezone('utc', now()) returns `timestamp WITHOUT time zone` — the wall
  -- clock in UTC — and assigning that to a timestamptz re-interprets it in the
  -- SERVER's TimeZone. On Supabase the database is UTC so the two agree, which
  -- is why the column DEFAULTs above (copied from the accounts migration for
  -- consistency) are harmless. Inside a function it is free to be exactly right
  -- instead of accidentally right: now() is the absolute instant under any
  -- server setting.
  now_ts  timestamptz := now();
  -- The day, however, genuinely IS a UTC wall-clock question, so it keeps the
  -- conversion. See the note on player_days.
  today   date := (timezone('utc', now()))::date;
begin
  -- Negative scores cannot reach here — submit-score rejects them in step 1 of
  -- its validation — but greatest(...) makes the counters unable to go backwards
  -- even if that ever changes, and a total_score that can decrease is a badge
  -- that can un-earn itself.
  insert into public.player_stats as s (
    user_id, game_id, plays, best_score, total_score, first_played_at, last_played_at
  )
  values (
    p_user_id, p_game_id, 1, greatest(p_score, 0), greatest(p_score, 0), now_ts, now_ts
  )
  on conflict (user_id, game_id) do update
    set plays          = s.plays + 1,
        best_score     = greatest(s.best_score, excluded.best_score),
        total_score    = s.total_score + excluded.total_score,
        last_played_at = excluded.last_played_at;

  -- The UTC date, not the server's local one. See the note on player_days.
  insert into public.player_days (user_id, played_on)
  values (p_user_id, today)
  on conflict do nothing;

  return query
  select
    -- coalesce on every aggregate: the row this call just inserted guarantees at
    -- least one row, but an aggregate over an empty set is NULL and a NULL
    -- plays_total would read as "no plays" in the evaluator rather than erroring.
    coalesce(sum(s.plays), 0)::integer,
    coalesce(array_agg(s.game_id order by s.game_id), array[]::text[]),
    coalesce(max(s.best_score) filter (where s.game_id = p_game_id), 0)::integer,
    (select count(*)::integer
       from public.player_days d
      where d.user_id = p_user_id),
    -- Already-earned keys travel back with the counters so the caller can tell
    -- NEWLY unlocked from merely qualifying without a second query. The insert
    -- that follows is still `on conflict do nothing`, because this read and that
    -- write are not one transaction from the caller's point of view.
    coalesce(
      (select array_agg(a.achievement_key order by a.achievement_key)
         from public.player_achievements a
        where a.user_id = p_user_id),
      array[]::text[]
    )
  from public.player_stats s
  where s.user_id = p_user_id;
end;
$$;

comment on function public.record_play(uuid, text, integer) is
  'Records one accepted submission and returns the totals the badge evaluator needs. Called only by the submit-score Edge Function.';

-- Functions are executable by PUBLIC by default. The table privileges would stop
-- an anon caller anyway (this is SECURITY INVOKER), but a function that writes
-- counters should not be callable by every role that can reach PostgREST, and
-- an error message is a slower answer than a 404.
revoke all on function public.record_play(uuid, text, integer) from public;
grant execute on function public.record_play(uuid, text, integer) to postgres, service_role;
