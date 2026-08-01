-- Accounts: profiles, gamer tags, name reports, and verified leaderboard rows.
--
-- WHAT THIS IS FOR
--
-- Until now the leaderboard was anonymous: `player_name` is free text typed at
-- game over, so nothing stops two players using the same name, and nothing
-- connects a score to a person. This migration adds the schema for real
-- accounts on top of Supabase Auth:
--
--   * public.profiles      one row per auth.users row, holding the gamer tag
--   * public.name_reports  moderation queue for abusive tags
--   * leaderboard.user_id  optional link from a score to an account
--   * leaderboard.is_verified  the public "this score belongs to an account" flag
--
-- Signing in stays OPTIONAL. `user_id` is nullable and `player_name` is
-- untouched, so anonymous submissions keep working exactly as they do today and
-- an old deployed Edge Function that knows nothing about accounts keeps
-- inserting successfully — the same property that made the game_id migration
-- safe to apply ahead of the function.
--
-- IDEMPOTENT ON PURPOSE
--
-- Like 20260730000000_prune_leaderboard_per_game.sql, this may be applied by
-- hand through the dashboard and therefore never recorded in
-- supabase_migrations. Every statement tolerates being run twice.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- It does not validate gamer tags beyond uniqueness and non-emptiness. Length,
-- character set and profanity live in the client validator and the Edge
-- Function, because those rules need to produce a readable error message and a
-- CHECK constraint cannot. This file is the backstop, not the primary path.


-- ---------------------------------------------------------------------------
-- 1. profiles
-- ---------------------------------------------------------------------------
--
-- id is both the primary key and the foreign key to auth.users. One profile per
-- user, no surrogate key, and ON DELETE CASCADE means deleting the auth user
-- deletes the profile — there is no state in which a profile outlives its
-- account.
--
-- TWO COLUMNS FOR ONE NAME, deliberately:
--
--   gamer_tag      exactly what the player typed, and what is rendered
--   gamer_tag_key  the collision key: lower-cased, `_` and `-` removed
--
-- Uniqueness is enforced on the KEY, not the display form. Without that,
-- "Rick_Dangerous", "rick-dangerous" and "RickDangerous" are three different
-- rows and are indistinguishable to a human reading the leaderboard — which is
-- precisely the impersonation this table exists to prevent. Storing the display
-- form separately is what keeps the player's own capitalisation on screen.
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  gamer_tag     text not null,
  gamer_tag_key text not null unique,
  created_at    timestamptz not null default timezone('utc', now()),
  -- Moderation state. NOT client-readable — see the grants below.
  banned_at     timestamptz,
  ban_reason    text
);

comment on table public.profiles is
  'One row per auth.users row. gamer_tag is the display form; gamer_tag_key is the lower-cased, separator-stripped uniqueness key.';
comment on column public.profiles.gamer_tag_key is
  'lower(translate(gamer_tag, ''_-'', '''')). Unique. Prevents look-alike impersonation.';

alter table public.profiles enable row level security;

-- Profiles are a public directory: the leaderboard has to render a tag next to
-- a score for a player who is not signed in, so anonymous SELECT is required.
drop policy if exists "Allow public read access to profiles" on public.profiles;
create policy "Allow public read access to profiles"
  on public.profiles
  for select
  to public
  using (true);

-- No INSERT, UPDATE or DELETE policy for anon/authenticated, matching the rule
-- the leaderboard table already follows: clients never write to the database
-- directly. Profile rows are created by the signup trigger below (which runs as
-- definer) and changed only by an Edge Function holding the service-role key.

-- COLUMN-LEVEL GRANTS, NOT A BLANKET ONE.
--
-- This is the important part and it is easy to get wrong. RLS is ROW-level: a
-- policy can decide whether a row is visible, and it has no way to hide a
-- COLUMN within a visible row. `using (true)` therefore exposes banned_at and
-- ban_reason to every anonymous visitor unless the grant stops them — and
-- ban_reason is free-text moderator notes about a named person.
--
-- Privileges are the mechanism that operates at column granularity, so the
-- table-level grant is revoked and replaced with an explicit column list. This
-- also closes the inference channel: PostgreSQL requires SELECT privilege on
-- every column a query REFERENCES, not just the ones it returns, so
-- `?banned_at=not.is.null` and `?order=banned_at` are rejected with 42501 too.
--
-- The revoke is not optional even on a brand-new table. Depending on when the
-- project was created, Supabase may carry ALTER DEFAULT PRIVILEGES that grant
-- new public-schema tables to anon and authenticated automatically; revoking
-- first makes this migration's result independent of that.
--
-- CONSEQUENCE FOR CLIENT CODE: with column-level grants a `select=*` request
-- FAILS with 42501 "permission denied for table profiles" rather than returning
-- the permitted subset — PostgreSQL expands `*` to every column and checks all
-- of them. supabase-js `.select()` with no argument means `*`. Always name the
-- columns, as js/shared/net/leaderboard.js already does.
--
-- `id` IS PUBLIC HERE, AND THAT IS A CHOICE. profiles.id is the auth.users
-- UUID, so granting it makes that UUID discoverable for anyone whose gamer tag
-- is known. It is granted because it is the key the client joins on to render a
-- profile, and because the UUID on its own authorises nothing — it is not a
-- secret, it is a name. What it must not become is a link between an account
-- and a list of scores; see the leaderboard grant in section 3.
revoke all privileges on table public.profiles from anon, authenticated;
grant select (id, gamer_tag, created_at) on table public.profiles to anon, authenticated;
grant all on table public.profiles to postgres, service_role;


-- ---------------------------------------------------------------------------
-- 2. name_reports
-- ---------------------------------------------------------------------------
--
-- The moderation queue for "this gamer tag is abusive". reporter_id is nullable
-- and ON DELETE SET NULL so a report survives the reporter deleting their
-- account; profile_id is ON DELETE CASCADE because a report about a profile
-- that no longer exists is noise. resolved_at null means still open.
create table if not exists public.name_reports (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  reporter_id uuid references auth.users (id) on delete set null,
  reason      text,
  created_at  timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz
);

comment on table public.name_reports is
  'Moderation queue for abusive gamer tags. Service-role only: RLS is on with no policies, and no privileges are granted to anon or authenticated.';

alter table public.name_reports enable row level security;

-- DELIBERATELY NO POLICY, FOR ANY ROLE.
--
-- RLS with zero policies denies everything to every role that is subject to
-- RLS. Combined with granting no privileges at all to anon and authenticated,
-- this table is unreachable from a client: an anonymous or signed-in caller can
-- neither read a report nor file one directly. Only the service role — which
-- bypasses RLS — can touch it, which means an Edge Function is the only way in.
--
-- That is the same shape as the leaderboard: the client is untrusted, so a
-- report is filed by calling a function that can rate-limit it and attribute it
-- to the caller's verified JWT, rather than by a client INSERT that could be
-- forged or flooded. Two locks (no policy AND no grant) rather than one is
-- intentional; either alone would be sufficient, and defence-in-depth here
-- costs nothing.
revoke all privileges on table public.name_reports from anon, authenticated;
grant all on table public.name_reports to postgres, service_role;


-- ---------------------------------------------------------------------------
-- 3. leaderboard gains an account link
-- ---------------------------------------------------------------------------
--
-- Two separate ALTER TABLE statements on purpose. is_verified's generation
-- expression references user_id, and whether a generated column may reference a
-- column added by an earlier subcommand of the SAME ALTER TABLE is not
-- something the documentation guarantees. Splitting them removes the question
-- entirely and costs one extra statement.
--
-- ON DELETE SET NULL, not CASCADE: deleting an account must not delete that
-- player's scores. The row stays, loses its account link, and is_verified
-- recomputes to false — a stored generated column is recomputed whenever the
-- row is updated, and the foreign key's SET NULL is an update. The score
-- becomes anonymous rather than disappearing from the board.
alter table public.leaderboard
  add column if not exists user_id uuid references auth.users (id) on delete set null;

-- is_verified is derived, never written. A plain boolean column would be a
-- second source of truth that a buggy insert could set true with user_id null,
-- which is exactly the claim the badge is supposed to make unforgeable.
-- GENERATED ALWAYS ... STORED makes that state unrepresentable: the column
-- cannot be inserted into or updated at all, and the expression is a NULL test
-- on a column of the same row, which satisfies the immutability restriction.
--
-- NOTE: unlike the game_id column, this DOES rewrite the table and takes an
-- ACCESS EXCLUSIVE lock, because the value must be computed and stored for
-- every existing row. At ~100 rows that is imperceptible. It would not be at a
-- million, so do not copy this shape onto a large table without thinking.
alter table public.leaderboard
  add column if not exists is_verified boolean
    generated always as (user_id is not null) stored;

comment on column public.leaderboard.user_id is
  'Optional account link. NULL for anonymous submissions. Never exposed to clients.';
comment on column public.leaderboard.is_verified is
  'Derived from user_id. The public badge — true means the score was submitted by a signed-in account.';

-- No index on user_id. The foreign key's ON DELETE SET NULL and any future "my
-- scores" query would both seq-scan without one, but the prune trigger holds
-- this table at 100 rows per game, so the planner would ignore the index
-- anyway. Add it when there is a query that needs it, not before.

-- REPLACE THE TABLE-WIDE GRANT WITH A COLUMN LIST.
--
-- 20260721000001_grants.sql did `GRANT SELECT ON TABLE public.leaderboard TO
-- anon, authenticated`, which would now include user_id. That must not be
-- public. The verified BADGE is public information — it is rendered next to the
-- score — but the LINK behind it is not.
--
-- Precisely what the omission buys: user_id is the join key from a score to
-- public.profiles, whose id and gamer_tag anyone may read. Granting it would
-- let anyone stitch every row on the board to an account, including rows whose
-- free-text player_name says something else, and so assemble one player's
-- complete cross-game history from a single query. Withholding it does not make
-- the UUID secret (profiles.id already exposes that) — it withholds the
-- linkage, which is the part that deanonymises people. is_verified carries the
-- whole signal the UI needs and carries no identity at all, so user_id is
-- deliberately left out of the grant below.
--
-- Nothing in the client breaks: js/shared/net/leaderboard.js already selects
-- named columns ('player_name, score, session_duration_seconds, created_at')
-- and filters on game_id, all of which are granted. See the note above about
-- `select=*` — it is now an error on this table too.
revoke all privileges on table public.leaderboard from anon, authenticated;
grant select (
  id,
  player_name,
  score,
  session_duration_seconds,
  created_at,
  game_id,
  is_verified
) on table public.leaderboard to anon, authenticated;

-- Unchanged from 20260721000001_grants.sql, restated because the revoke above
-- is role-scoped to anon/authenticated and this line is what the Edge Function
-- writes through.
grant all on table public.leaderboard to postgres, service_role;

-- public.prune_leaderboard(keep) IS UNAFFECTED. Verified by reading it in
-- 20260730000000_prune_leaderboard_per_game.sql: it references only id,
-- game_id, score and created_at, in the ranking CTE and in the DELETE ... USING
-- join key. It never does SELECT *, never enumerates columns, and never writes
-- to the leaderboard other than by deleting whole rows — so it cannot collide
-- with a GENERATED ALWAYS column, which rejects writes. It runs SECURITY
-- INVOKER from an AFTER INSERT trigger, and the only role that can insert is
-- service_role, whose privileges the revoke above does not touch. No change
-- needed, and none made.


-- ---------------------------------------------------------------------------
-- 4. Signup trigger: every auth user gets a profile
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER because the row is inserted during signup, when the session
-- is still anon and anon has no INSERT privilege on profiles (by design — see
-- above). `set search_path = ''` so a function running with the owner's rights
-- cannot be tricked into resolving `profiles` to some other schema's table via
-- a caller-controlled path; every reference below is schema-qualified.
-- pg_catalog is always searched implicitly, so lower()/translate()/btrim()
-- still resolve and cannot be shadowed.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tag text;
begin
  tag := new.raw_user_meta_data ->> 'gamer_tag';

  -- Absent key, JSON null, empty string, and whitespace-only all fail here.
  -- Failing loudly is the point: a profile row is not optional, and a user
  -- created without one would be an account that can sign in but can never
  -- appear on the leaderboard — a broken state that is invisible until someone
  -- plays a game. Better to refuse the signup.
  if tag is null or btrim(tag) = '' then
    raise exception
      'gamer_tag is required at signup: pass it in raw_user_meta_data (supabase-js: signUp({ options: { data: { gamer_tag } } }))';
  end if;

  insert into public.profiles (id, gamer_tag, gamer_tag_key)
  values (
    new.id,
    -- Stored exactly as typed. The player's capitalisation is theirs.
    tag,
    -- Collision key: case-folded, separators removed. translate() with an empty
    -- `to` string DELETES the listed characters rather than substituting them.
    lower(translate(tag, '_-', ''))
  );

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT ON auth.users. Creates the matching public.profiles row from raw_user_meta_data->>''gamer_tag''. Raises if that is missing or blank.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- THE PROPERTY THIS TRIGGER EXISTS FOR, AND ITS COST.
--
-- The trigger runs INSIDE the transaction that inserts into auth.users. So if
-- two people claim the same gamer_tag_key at the same instant, the loser's
-- unique-violation aborts that whole transaction — the auth.users row is rolled
-- back with it. There is no window in which an account exists without a
-- profile, and no orphaned auth.users row to clean up later. Doing this check
-- in application code after signup cannot give that guarantee: the account is
-- already committed by the time the check runs, and the compensating delete can
-- fail.
--
-- The honest cost: GoTrue does not surface the constraint name or this
-- function's message. The client sees a generic "Database error saving new
-- user" with no indication that the problem was the name. That is a bad error
-- message for what is, at signup, the most likely failure.
--
-- Which is why this is the BACKSTOP, not the primary path. The friendly check —
-- "that tag is taken, try another" — belongs in the Edge Function that runs
-- before signup, where it can query gamer_tag_key and answer in plain language.
-- That check is racy by construction (nothing stops a second claim between the
-- lookup and the signup), and this trigger is what makes losing that race safe
-- rather than corrupting. Both are needed; neither replaces the other.
--
-- SCOPE NOTE: this fires for EVERY auth.users insert, including ones made from
-- the Supabase dashboard, the admin API, and anonymous sign-ins. All of those
-- will now fail unless they pass a gamer_tag in user metadata. Anonymous
-- sign-ins are disabled in config.toml, so this is currently only a constraint
-- on admin-created users, and it is the intended behaviour: an account without
-- a gamer tag has no way to be shown on a leaderboard.
