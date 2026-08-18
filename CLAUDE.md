# CLAUDE.md

Browser-based casual arcade (Tetris, Snake, Breakout and Hivebreak) on GitHub
Pages, with a Supabase backend for the global leaderboard and player accounts.
These are project standards — follow them on every task.

The code is proprietary — see `LICENSE.md`. The repo is public because GitHub
Pages on the free plan requires it, not because the code is free to take.

## Working rules

- Don't state a browser-support fact, API signature, or version-gated import from
  memory. Check current docs first, and say which version a pattern requires.
- If a spec, issue, or instruction contains a bug or internal contradiction, flag it
  before implementing. Don't build on a broken premise.
- Prefer the smallest change that fully solves the problem. Ask before large refactors.
- Distinguish what you verified, what you inferred, and what you assumed. "I couldn't
  verify this" is an acceptable answer; a confident guess is not.

## Commands

This project has **no install step, no bundler, no transpile, no typecheck and no
lint**. That is deliberate — it is vanilla ES modules served as-is. Do not invent a
`npm run build` that does not exist, and do not report "all checks pass" on the
strength of a toolchain this repo does not have.

The complete loop:

```bash
python3 -m http.server 8000    # serve the site; open http://localhost:8000
node test/run-node.mjs         # unit tests, zero dependencies — must pass
```

Tests also run in the browser at `/test/` once a server is up. Both runners load
the same files; keep `test/run-node.mjs` and `test/index.html` in sync when adding
a suite.

`test/e2e-accounts.mjs` is the one exception and is **not** in either runner. It
needs Docker and a running `supabase start`, and it writes to the local
database, so it would turn `node test/run-node.mjs` red on any machine without
Docker up. Run it by hand after touching auth, the account pages, the Edge
Functions, the accounts migration or the achievements migration — it covers the
things unit tests cannot reach (the auth hook firing inside the signup
transaction, column-level grants, `is_verified` recomputing on account deletion,
the 6-digit code arriving, badges being awarded exactly once and cascading away
with the account). Every run mints a fresh email and tag, so it is re-runnable.

```bash
supabase start
supabase functions serve        # the suite calls four of them, not just one
node test/e2e-accounts.mjs      # 48 checks; needs the local stack up
```

On Docker Desktop for macOS the CLI may hang silently with no output and no
containers: it looks for `/var/run/docker.sock`, which Desktop does not create
unless "Allow the default Docker socket to be used" is on. The socket is at
`~/.docker/run/docker.sock` (the `desktop-linux` context), so
`export DOCKER_HOST="unix://$HOME/.docker/run/docker.sock"` is the fix. Note
`supabase start` prints nothing at all when it is not attached to a TTY, so
silence is not a failure signal — watch `docker ps` instead.

Supabase (local, Docker required):

```bash
supabase start
supabase functions serve submit-score
supabase db reset                   # rebuild from migrations/ + seed
supabase migration new <name>       # never hand-edit an applied migration
```

## Definition of done

A task is not done until, in this order:

1. `node test/run-node.mjs` passes.
2. Changed behavior is exercised — a test if the logic is testable, an explicit
   manual repro (steps + observed result) if it isn't.
3. The pages you touched load with **zero 404s** in the Network panel. Most of this
   codebase is untested module wiring, so a broken import path is the likeliest
   regression and the tests will not catch it.
4. Anything touching canvas sizing, input, or audio is checked in at least one
   mobile Safari context, not just desktop Chrome.
5. You state plainly what you did **not** verify.

Never report a task complete on the strength of the diff alone.

**Note on automated browsers:** a headless/preview browser pane may report
`document.visibilityState === 'hidden'` and run **zero** `requestAnimationFrame`
callbacks. In that state the game loop never ticks, the engine auto-pauses on
`visibilitychange`, and the HUD never repaints — because HUD updates happen inside
the renderer callback. None of that indicates a bug. Verify gameplay through
`engine.dispatch` paths (the on-screen buttons), which run outside the step
boundary, or in a real browser window.

## Do not touch

- `.env`, `.env.*`, or any file holding keys. Never print a service-role key, never
  paste one into client code, never commit one.
- Migrations that have already been applied. Add a new migration instead.
- Deployed Edge Functions — no `supabase functions deploy` without being asked.
- `js/shared/` when adding a game (see Architecture). **One exception has been
  taken, deliberately:** `js/shared/net/leaderboard.js` gained a required
  `gameId` argument when Snake landed. It was not game-agnostic before, it was
  game-*blind* — no game parameter at all, so it could not serve two games. That
  is the same defect `fitPlayfield` had inside `shared/render/geometry.js`, and
  the fix is the house pattern: take the game-specific value as an argument and
  throw rather than default. A third game needs no further `js/shared/` edits.
  **That prediction has now been tested TWICE and held both times.** Breakout was
  built without touching a single file under `js/shared/`, including its paddle
  axis, which `createKeyboard`'s existing
  `heldActions`/`suppressInitial`/`axis` options already expressed. **Hivebreak
  — a sprite-based formation shooter, the least Tetris-shaped game here — also
  needed zero shared edits.** Three things that looked like they would force one
  did not:
  - A HELD TRIGGER. `createKeyboard` already returned `isHeld(action)`, so the
    trigger is one more entry in `heldActions` beside the steering axis.
  - CONTINUOUS, NON-GRID MOVEMENT at 14x18 tiles. `fitGrid` takes its column and
    row counts as arguments and snaps the cell to whole device pixels; a game
    whose ships sit at fractional tile coordinates uses it unchanged, because the
    grid is a coordinate system rather than a constraint on movement.
  - SPRITES, the first `drawImage` in the repo. Baking pixel data into a canvas
    is a `render/` concern and stayed inside `js/games/hivebreak/render/`.

  What did not generalise went into the game's own `input/` directory each time,
  following the precedent Snake set with its four-way swipe: pointer-driven
  paddle control and held-axis buttons in `js/games/breakout/input/`, and
  relative drag steering plus a held fire button in
  `js/games/hivebreak/input/`. Note Hivebreak's pointer is deliberately NOT
  Breakout's — Breakout maps the paddle to the pointer's absolute x, which on a
  portrait field would put the player's thumb over the formation they are
  aiming at, so Hivebreak accumulates a relative delta instead. Two games
  needing the opposite behaviour from the same concept is exactly why it is not
  shared.

  If you find yourself wanting another exception, the bar is "shared code cannot
  express this at all", not "this would be convenient".
  **Accounts added `js/shared/net/{client,auth}.js` and
  `js/shared/account/session.js`, and that is not a violation of this rule** —
  the rule is scoped to *adding a game*. Accounts are cross-cutting
  infrastructure and `net/` is where this project already keeps the network
  boundary. The game-agnostic test still holds: no game-specific value is
  imported into any of them.
- Existing tests. Don't delete, skip, or loosen an assertion to make a suite green;
  if a test is wrong, say so and stop.
- The gamer tag blocklist tests. The Scunthorpe cases exist to constrain the
  blocklist; if one fails, the list is wrong, not the test.

No new runtime dependencies without asking first. Dev dependencies: ask if it changes
the build. No force-push, no rewriting published history. One logical change per commit.

`standardwebhooks@1.0.0` (esm.sh, used only by the `before-user-created` Edge
Function to verify the auth-hook signature) is the one runtime dependency added
since that rule was written, and it was approved explicitly.

## Architecture

```
index.html          arcade hub (the game picker)
games/<name>/       one directory per game: index.html and its sub-pages
account/            sign in, create account, reset password, report a gamer
                    tag — ordinary documents, not game pages
css/                tokens.css is the shared design system; hub.css, pages.css,
                    account.css (the only form styling in the project)
js/
  hub/              registry.js (the game list) + hub.js
  account/pages/    the four account page modules
  shared/           game-agnostic modules — do not edit to add a game
    engine/         createLoop (fixed timestep, injected), clock
    render/         dpr, geometry (grid-size agnostic)
    input/          keyboard, touch, autorepeat, haptics
    storage/        storage, createScoresStore(key)
    ui/             overlay shell, a11y announcer, procedural backgrounds
    audio/          synth
    account/        session.js — localStorage display cache, NO network
    achievements/   badgeShelf.js (pure DOM; imports the catalogue from
                    supabase/functions/_shared/badges.js), boardMarks.js
                    (the one place that module meets net/)
    net/            client.js (the one Supabase client), leaderboard.js,
                    auth.js, badges.js — the ONLY modules that talk to the
                    network
    util/           dom, emitter, rng
  games/<name>/     one directory per game, mirroring the shared layout
                    tetris/, snake/, breakout/ and hivebreak/ exist; use
                    breakout/ or hivebreak/ as the reference for a new game.
                    hivebreak/ additionally shows the sprite path: render/
                    spriteData.js is pixel art written as text, baked once into
                    a canvas by render/sprites.js, so the repo still ships zero
                    binary assets
sw.js               ONE service worker, scope '/', covering the whole site
supabase/
  functions/        Edge Functions. submit-score, before-user-created (an auth
                    hook), report-name, delete-account, and _shared/ —
                    cors.ts, gamerTag.js and badges.js. The two .js files are
                    plain, import-free and loaded unchanged by Deno, Node and
                    the browser.
  migrations/       SQL
  templates/        LOCAL mirrors of the two auth emails, so `supabase start`
                    sends the 6-digit code production sends. Production's live
                    in the dashboard; these change nothing there.
```

`js/shared/net/client.js` exists because there must be exactly **one**
`createClient` call in the site. Two clients means two independent auth
storages, so a session established through one is invisible to the other and a
signed-in player's score submits anonymously. Import the client; never call
`createClient` again.

One responsibility per module. Adding a game means: a directory under `games/`, a
directory under `js/games/`, and one entry in `js/hub/registry.js`. It must never
require editing `js/shared/`.

Shared modules take their game-specific values as **arguments, not imports**.
`createLoop` requires a `timestep`; `createAutoRepeat` requires `das` and `arr`;
`createScoresStore` requires a storage key. All of them throw rather than defaulting,
because a wrong tick rate or a shared score key fails silently.

Invariants to check before opening a PR:

- No import from `js/games/` inside `js/shared/`. The dependency runs one way.
- No `document`/`window` reference in a game's `core/`.
- No state mutation in `render/`.
- No `fetch` or Supabase import outside `js/shared/net/`. Note the Supabase client
  itself is currently loaded from a jsDelivr `<script>` tag in the game's HTML and
  read off `window.supabase`.

## Deployment

GitHub Pages, **legacy branch deploy** from `main` at `/`, on the custom domain in
`CNAME`. There is no build *workflow* of ours, and near enough everything on `main`
is served, including `Tetris_v1/` and `test/`.

**"What is on `main` is what is served" was the mental model here, and it was wrong
in one specific way that took the site down on 2026-08-16.** Branch-deploy Pages runs
the files through **Jekyll**, and per GitHub's own docs Jekyll does not build files or
folders that start with `_`, `.` or `#`. So `supabase/functions/_shared/` — the
directory CLAUDE.md deliberately points the BROWSER at, because `gamerTag.js` and
`badges.js` are import-free files loaded unchanged by Deno, Node and the browser —
**404'd in production while every sibling path served 200.** Measured: 
`/supabase/functions/submit-score/index.ts` → 200, `/supabase/functions/_shared/badges.js`
→ 404.

That is a *silent, path-shaped* failure. It cannot be caught by `python3 -m
http.server`, which serves underscore directories happily, so the local check that
CLAUDE.md's definition-of-done step 3 asks for passes while production is broken. An
ES module 404 takes down the whole import graph, not one feature: `js/games/*/main.js`
imports `scoresView.js` → `badgeShelf.js` → the 404, so all three games, all three
leaderboard pages and the account page stopped booting at once while the hub, which
imports none of it, looked fine.

**The fix is the empty `.nojekyll` at the repo root. Do not delete it.** With it,
Pages serves the tree as-is and underscore paths resolve.

- Adding a file under a `_`-prefixed directory that the browser must fetch is safe
  *only* while `.nojekyll` exists. It is one empty file standing between the site and
  a repeat of this outage.
- After any change that adds a browser-fetched path, check it against the **deployed**
  origin, not just localhost. Local static serving and Pages do not agree.

A previous `.github/workflows/deploy.yml` assembled a clean `_site` and injected the
Git SHA into the service-worker cache name. It ran green on every push and was never
served — Pages was set to branch deploy the whole time, so the injection never took
effect. It has been deleted. **Bump `CACHE` in `sw.js` by hand on any change to
cached assets.** Assets are cache-first; a stale cache name serves old files forever.

## Canvas & rendering

Three coordinate systems, never conflated:

| System | What it is | Where it lives |
|---|---|---|
| Virtual simulation grid | Game state, physics, collision | JS state only |
| CSS logical size | What the layout engine sees | `style.width/height` |
| Physical drawing buffer | Actual GPU pixels | `canvas.width/height` |

- Init: `canvas.width = logicalW * devicePixelRatio` (same for height), keep
  `style.width/height` at logical px, then `ctx.scale(dpr, dpr)`. Use
  `sizeCanvas()` in `js/shared/render/dpr.js` rather than hand-rolling this.
- Re-run init on `ResizeObserver` fire and on orientation change. DPR can change
  mid-session when a window moves between displays — `watchDpr()` handles the
  re-registration, which a plain media query cannot.
- Assigning `width`/`height` CLEARS the canvas. Every resize invalidates the layer.
- Simulation and collision run in the virtual grid only, so behavior is identical
  across devices. Projection to screen space happens at draw time.
- Cell sizes are snapped so `cell * dpr` is a whole number — see
  `fitGrid()`. This is what keeps blocks seam-free at fractional ratios
  (Windows scaling at 125%/150%), and it is why `image-rendering: pixelated` is
  not used.
- Pre-allocate entity pools (snake segments, bricks, particles). Do not allocate
  inside the loop — GC pauses drop frames.

### Performance targets

60fps (16.6ms frame budget), UI acknowledgment within 50ms, LCP ≤2.5s on 3G.

**These are targets, not measured results, and nothing in the repo currently tests
them.** Do not claim a change meets them without a profile or trace. If you have
measured, say what you measured on and how; otherwise say the budget is unverified.

## Mobile / WebKit

- Canvas gets `touch-action: none; -webkit-touch-callout: none; user-select: none`.
  This is what kills the legacy tap delay.
- **Viewport meta is split by page type**, deliberately:
  - *Game pages* keep `maximum-scale=1, user-scalable=no`, so a stray pinch or
    double-tap cannot fire mid-play. This is a considered trade against WCAG 1.4.4;
    iOS Safari ignores it for accessibility anyway. See the README.
  - *Hub, about and leaderboard* are ordinary documents and use a standard zoomable
    viewport. Do not add the zoom lock to them.
- `overscroll-behavior: none` on `html, body` to kill pull-to-refresh and
  rubberbanding. Old-WebKit fallback: `overflow: hidden` on body plus an
  absolutely-positioned wrapper.
- AudioContext starts suspended. Unlock with a one-shot handler bound to
  `pointerdown`, `touchstart`, `touchend` AND `keydown` — desktop Chrome suspends
  too, so touch-only unlocking leaves desktop silent. Await `resume()`'s promise,
  then remove all listeners.

## Service worker

One worker, `sw.js`, scope `/`. A per-game worker is not an option: a game at
`/games/<name>/` imports shared modules from `/js/shared/`, outside its scope, so
the root worker would fetch them regardless.

- **Navigations are network-first**, assets cache-first. This is load-bearing, not a
  preference: a cache-first root document pins the site to whatever was cached first
  and no deploy can dislodge it. That is exactly the trap the single-game version
  left behind, and why `activate` deletes every cache but the current one.
- Never intercept cross-origin requests.
- **Every response the worker stores is fetched with `cache: 'reload'`.** A plain
  `fetch()` inside a service worker still consults the browser's HTTP cache, and
  Pages serves assets `max-age=600` — so for ten minutes after a deploy a
  returning visitor's new worker can launder PRE-deploy bytes into the brand-new
  cache generation, where cache-first then pins them forever. Bumping `CACHE`
  cannot fix that; the bump is what created the poisoned generation. Measured
  2026-07-29 inside a live service worker: a plain `fetch` returned the
  superseded file, the same URL with `cache: 'reload'` returned the current one.
  Do not "simplify" `new Request(url, { cache: 'reload' })` back to `fetch(url)`
  or `cache.add(url)`.
  The navigation branch is the deliberate exception — a navigation Request cannot
  be reconstructed (mode downgrades to `same-origin`, redirect to `follow`, and a
  followed-redirect response is a TypeError for a navigation), and network-first
  means a stale document is replaced next navigation rather than pinned.

### End-of-session telemetry

**Not currently implemented** — scores are submitted at game over via
`supabase.functions.invoke`. If you add a beacon, bind **both**
`visibilitychange` (on `document`, when `visibilityState === 'hidden'`) and
`pagehide` (on `window`), and guard with a once-flag so the score posts a single
time. Neither event alone is sufficient, and the failure modes don't overlap:

- `visibilitychange` is the recommended session-end signal, but Safari may skip it
  when the page navigates away via a link click.
- `pagehide` covers that case, but is itself unreliable — notably when a mobile user
  switches apps and later closes the browser from the app manager.

Do not use `unload` or `beforeunload`: they break bfcache and Safari doesn't fire
`beforeunload` at all.

```js
let sent = false;
const flush = () => {
  if (sent) return;
  sent = true;
  if (!navigator.sendBeacon(url, payload)) {
    fetch(url, { method: 'POST', body: payload, keepalive: true });
  }
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
window.addEventListener('pagehide', flush);
```

A dropped beacon often surfaces as a misleading CORS error in Safari's console;
don't chase that.

## Supabase backend

Current state: a single non-partitioned `leaderboard` table **with a `game_id`
column** (`text NOT NULL DEFAULT 'tetris'`, added by
`migrations/20260727000000_add_game_id.sql`), indexed
`(game_id, score DESC) INCLUDE (player_name, created_at)`. One `submit-score`
Edge Function, which validates `game_id` against an allowlist. Four games write
to it: `tetris`, `snake`, `breakout` and `hivebreak`.

`migrations/20260731000000_accounts.sql` added `profiles`, `name_reports`, and
two columns on `leaderboard`: a nullable `user_id` and `is_verified`, a **stored
generated column** over it. Two consequences that are not obvious:

- You cannot INSERT `is_verified`. Writing to a generated column is an error.
- `user_id` carries `ON DELETE SET NULL`, so deleting an account fires an update
  and flips its rows to `is_verified = false`. The scores survive with the
  gamer tag they were submitted under, because `player_name` is denormalised.
  That is deliberate: deleting an account must not silently rewrite the board.

**Grants on `leaderboard` and `profiles` are now COLUMN-LEVEL**, and this bites.
RLS is row-level and cannot hide a column, so `profiles.banned_at` and
`leaderboard.user_id` are withheld by revoking the table grant and re-granting a
column list. Postgres expands `*` to every column and checks privilege on all of
them, so **`.select('*')` is now `42501`, not a filtered result** — and so is
filtering or ordering on a column you cannot read. Always name your columns. A
service-role client is unaffected, which is why the Edge Functions still work.

**Migration-before-client is a hard ordering constraint.** The client filters
`.eq('game_id', …)`; against a database without the column that is Postgres
`42703` and the global leaderboard fails outright. The column's `DEFAULT` is what
makes the reverse order safe: a *deployed function that does not know about
`game_id`* keeps inserting successfully and its rows are attributed to Tetris. So
schema first, then function, then client — and never ship the client ahead of the
schema.

- Edge Functions answer `OPTIONS` with a 200 **before any other logic**, and attach
  the same CORS headers to success AND error paths. An error response without CORS
  headers is opaque to the client.
- CORS headers: on `@supabase/supabase-js` v2.95.0+, import them from the SDK rather
  than hand-rolling — they stay in sync as the client adds headers.
  - With an import map / `deno.json`: `import { corsHeaders } from '@supabase/supabase-js/cors'`
  - Inline specifier: `import { corsHeaders } from 'npm:@supabase/supabase-js@^2/cors'`
  - Below 2.95.0: define them in `functions/_shared/cors.ts`.
- Lock `Access-Control-Allow-Origin` to real origins in production. `*` is dev-only.
  The deployed function currently uses `*`.
- *Deferred, not next* — LIST partitioning by `game_id`. It buys nothing at this
  row count, and it is the expensive shape: converting is **not** an in-place
  `ALTER`, it needs a new partitioned table, a data copy and a rename, plus a
  `PRIMARY KEY (id, game_id)` because the key must include the partition key.
  A plain column and a composite index give the same query plan here. Revisit
  when a single game's partition is large enough to matter, not before.
- **Pruning is IMPLEMENTED, and it keeps the top 100 PER GAME** — see
  `migrations/20260730000000_prune_leaderboard_per_game.sql`. The rule lives in
  `public.prune_leaderboard(keep)`, a plain callable function, invoked by an
  `AFTER INSERT ... FOR EACH STATEMENT` trigger on `leaderboard`.

  *This is a knowing deviation from the "pg_cron, never on the write path"
  standard below.* The trigger predates the function being written down: it was
  created by hand in the SQL editor, never as a migration, so the repo did not
  contain it and `db reset` did not reproduce it. Keeping the trigger was the
  smaller change; keeping the LOGIC in a standalone function is what makes
  moving to cron later a schedule plus a `DROP TRIGGER` rather than a rewrite.
  Move it when insert volume justifies the write-path cost, not before.

  **The failure it replaced is the one to remember.** The original ranked
  globally — `ORDER BY score DESC LIMIT 100` across the whole table — so the
  leaderboard became a contest between GAMES rather than between players.
  Whichever game had been played most filled all 100 slots. Measured
  2026-07-30: 100 rows, `tetris` 84 / `snake` 15 / `breakout` 1, with
  Breakout's only score at global rank 100 — the next one below it would have
  been deleted by the trigger fired by its own insert, and the player would
  have seen what looked exactly like a broken submission. Any per-game limit
  must partition by `game_id`. A global limit is only ever correct for a
  one-game arcade.

- **The global board shows at most 3 rows per name, and that cap is a READ-side
  rule, not a prune rule** — `capPerPlayer` in `js/shared/net/topScores.js`,
  applied by `fetchTopScores`. Without it one player's ten good runs fill the
  whole top 10 and the board records who played most rather than who played
  best. Three details are load-bearing:
  - `fetchTopScores` asks for **100** rows to return 10. That is the prune
    retention, i.e. every row the game has, which is what makes the filtered
    board exact rather than a best-effort slice of a window. Raise retention
    and `FETCH_LIMIT` must move with it.
  - The query now orders `score DESC, created_at ASC` — the same tie-break the
    prune function uses. Under a quota an undefined tie order stops being a
    harmless swap and becomes a row flickering on and off the board.
  - **Do not move this into `prune_leaderboard`.** Pruning deletes, and the only
    grouping key a client can see is a display name: `user_id` is deliberately
    ungranted, and `AAA` is both a common choice and what `toInitials()` pads to
    when nothing is typed, so it is shared by unrelated people. Capping a name on
    the write path would permanently destroy strangers' scores. Hiding a row is
    reversible; deleting one is not.

- Rank in a CTE — a window function cannot appear in `WHERE`. Delete on the FULL
  key: **deleting on `id` alone is a data-loss bug** once the table is
  partitioned, because `id` is not unique across partitions. Break ties
  deterministically (`created_at ASC`) or equal scores swap places at random.

```sql
WITH ranked AS (
  SELECT id,
         game_id,
         ROW_NUMBER() OVER (
           PARTITION BY game_id
           ORDER BY score DESC, created_at ASC
         ) AS rn
  FROM leaderboard
)
DELETE FROM leaderboard l
USING ranked r
WHERE r.rn > 100
  AND l.id = r.id
  AND l.game_id = r.game_id;
```

Anything that touches this table by hand — a dashboard trigger, a one-off
cleanup — **belongs in a migration**. The rule above existed only in the SQL
editor for days: invisible to the repo, absent from `db reset`, and impossible
to review. That is how it stayed wrong.

- PgBouncer in transaction mode. Assume bursty concurrent session-end traffic.

## Accounts and identity

Standard Supabase Auth: email + password, confirmed by a 6-digit code. The gamer
tag is the public name; the email is never public.

**Say the true thing about the email.** The requirement this was built against
was "the email is not saved in the database". With standard Supabase Auth that
is **false** — it lives in `auth.users`, same Postgres instance, different
schema. What is true, and what the sign-up page says, is that it is unreadable
by any client, not attached to any score, never shown on a leaderboard, never
visible to another player, and deletable on demand. Do not let that copy drift
back into the stronger claim. If the literal guarantee is ever wanted, it means
HMAC-hashed emails and a hand-rolled OTP, and losing built-in password reset.

**The gamer tag is validated in exactly one place that counts.**
`supabase/functions/_shared/gamerTag.js` is plain `.js` with zero imports so
Deno, Node and the browser all load the same file — that is why it is not `.ts`
and why the tests can cover the code that actually runs. The enforcement point
is the `before-user-created` auth hook, because `auth.signUp` is a public
endpoint and any client-side check is bypassable by calling the API directly.
The `profiles.gamer_tag_key` unique index is the backstop for the race.

- **The client never sees the blocklist.** The account page checks shape only.
- **Two tiers, and the split is the design.** `BLOCKED_CONTAINS` matches
  anywhere and is a Scunthorpe generator, so it is four entries; everything with
  an innocent substring use is exact-or-token. Tests assert `Scunthorpe`,
  `assassin`, `Cockburn`, `analysis`, `Bassett`, `Japan`, `Pakistan` are
  ACCEPTED. **If one fails, shrink the list — never the test.**
- **The blocklist is stored uncollapsed and candidates are tested in both
  folded forms.** Collapsing the list turns `boobs` into `bobs` and blocks the
  ordinary name Bobs. The collapsed comparison carries a length guard, because
  repeat-padding can only make a tag longer: `asss`(4) onto `ass`(3) counts,
  `Bobs`(4) onto `boobs`(5) does not.
- A blocklist is a speed bump. English only, public repo so the list is public,
  blind to novel spellings. Report-and-ban is the actual remedy.

**A signed-in player's name comes from the database, never the request body.**
`submit-score` resolves the JWT, reads `profiles.gamer_tag`, and ignores the
client's name field entirely. Anything that fails to resolve to a user is
anonymous — note the publishable key rides in the same `Authorization` header
when signed out, and it is not a JWT, so "header present" does not mean
"signed in".

Accounts are **optional**. `REQUIRE_ACCOUNT` in `submit-score` is the single
flip that makes gamer tags mandatory; the rejection branch is already written so
it stays one line.

### Email delivery — custom SMTP is not optional

Supabase's built-in mailer sends **2 messages an hour and only to addresses on
the project team**. It cannot serve real signups; this is a hard blocker, not a
rate limit you can live with. Production uses a custom SMTP provider (Resend's
free tier is 3,000/month, 100/day, one verified domain).

Custom SMTP is also what makes the 6-digit code possible at all: free projects
created after 2026-06-03 cannot edit auth email templates on the default mailer,
and the code comes from replacing `{{ .ConfirmationURL }}` with `{{ .Token }}`
in the *Confirm signup* and *Reset password* templates.

Dashboard-side settings that the repo cannot hold and that will silently break
things if missed: the SMTP credentials, both email templates, "Confirm email"
enabled, the `before-user-created` hook registered with its secret in the
function env, and the Site URL. `supabase/config.toml` configures `supabase
start` **only** — its `site_url` is deliberately localhost.

The local stack mirrors both templates in `supabase/templates/`, wired up in
`config.toml`. Without them `supabase start` mails a LINK, `verifyOtp` is never
exercised locally, and the one flow most worth testing is the one that is not.
Note `content_path` resolves from the REPO ROOT (`./supabase/templates/…`), not
from `supabase/` — the commented example in `config.toml` is misleading.

### Settled 2026-08-01 against the local stack (gotrue v2.194.0)

Both of the caveats that used to sit here are now measured, and one of them was
simply wrong.

- **`verifyOtp` type is `'signup'`** for a password signup, and `'recovery'` for
  a reset. Both verified with a real code out of the mail catcher.
- **The empty-`identities` duplicate-email signal does not exist in this
  version.** Measured, one signup per case, "Confirm email" ON:
  an UNCONFIRMED existing address returns 200 with `identities` of length **1**;
  a CONFIRMED one returns **422 `user_already_exists` / "User already
  registered"**. The array was never empty in either case. `signUp()` swallows
  the 422 specifically — matched on `error_code`, never on the bare status,
  because 422 is also GoTrue's weak-password answer. **The anti-enumeration
  claim is now weaker and the comments say so:** `/auth/v1/signup` still answers
  the question for anyone with curl, so the neutral copy keeps the SITE from
  being a point-and-click oracle and nothing more.

**The `before_user_created` hook rejection format is NOT what the docs say.**
Return **HTTP 200** with `{ error: { http_code: 4xx, message } }`. The
documented 4xx transport status makes GoTrue discard the body and answer
`500 / "Invalid payload sent to hook"`, so the player learns nothing about their
gamer tag — upstream bug, open: https://github.com/supabase/auth/issues/2235
Two plausible-looking shapes **fail open and create the account**
(`{ decision: 'reject', message }` and `{ error: "a string" }`). The full
measured matrix is in `before-user-created/index.ts` above `reject()`. Re-run it
before changing that function.

Locally the hook `uri` must be `http://host.docker.internal:54321/...`, not the
`127.0.0.1` the docs show: the caller is GoTrue inside its own container, where
127.0.0.1 is that container and nothing listens on 54321. The symptom is
`hook_timeout_after_retry` on every signup with the function never invoked.

Also confirmed here: the accounts migration applies cleanly from scratch; the
column-level grants are a real boundary (`select('*')` → 42501 on both tables,
`banned_at` and `user_id` unreadable, `name_reports` unreachable, direct INSERT
refused); and deleting an account leaves its scores in place with
`is_verified` flipped to false.

## Achievement badges

Account holders earn badges. `migrations/20260815000000_achievements.sql` adds
`player_stats`, `player_days` and `player_achievements`, plus
`public.record_play(user_id, game_id, score)`. Anonymous runs earn nothing —
`AAA` is shared by strangers, so there is no honest key to award against.

**Stats are the source of truth; a badge is a threshold over them.** The unlock
record is binary plus a timestamp and stores no progress, which is what makes a
badge added later award itself from counters that have been accumulating all
along. The catalogue and the rule live in
`supabase/functions/_shared/badges.js` — plain `.js`, zero imports, the
`gamerTag.js` pattern, so Deno, Node, the browser and the tests load the same
file. Unlike the blocklist, none of it is secret: the client imports it to
render the shelf.

Four things that are load-bearing:

- **The counters cannot come from `leaderboard`.** It is a top-100-per-game
  window behind a destructive trigger, so "50 games played" is not derivable
  from it. Nothing prunes the new tables; do not teach `prune_leaderboard`
  about them.
- **`player_stats` and `player_days` are service-role only** — RLS on, no
  policies, no grants — because they ARE the cross-game history that
  `leaderboard.user_id` is withheld to prevent assembling. `player_achievements`
  is publicly readable, which leaks nothing new: `profiles.id` and
  `profiles.gamer_tag` are already both granted, so tag → id is already public.
- **Distinct days are counted from `player_days`, one row per player per UTC
  date.** A per-game `distinct_days` counter summed across games double-counts a
  day on which someone played two games. The date is UTC and written down as
  such; timezone-naive streak aggregation is the classic bug here.
- **`top-ten` / `rank-one` use the RAW rank**, not the rank the board displays.
  `capPerPlayer(3)` means a player can hold raw rank 4 and appear second.

`submitScore` now resolves to `{ row, unlocked }`. It still accepts the old bare
array, so the client is safe to ship ahead of the function deploy. The award
path is wrapped: a badge failure logs and returns `unlocked: []`, and never
fails the submission — the score is committed by then and saying otherwise
would be false.

Verified end to end against the local stack 2026-08-15: the migration applies
from scratch; `record_play` accumulates plays across games, never lets
`best_score` go backwards, and reports **one** distinct day for four plays in a
day; `on conflict do nothing ... returning` returns only genuinely-new keys;
`player_stats` and `player_days` answer 42501 even to their owner's token;
badges cascade away on account deletion while the scores survive unverified.

**One thing that does NOT generalise from the accounts migration:** `select=*`
on `player_achievements` SUCCEEDS. `*` fails on `profiles` and `leaderboard`
because their grants WITHHOLD a column, not because the grants are
column-level. This table withholds nothing, so there is no 42501 to assert.

**Hivebreak is deliberately NOT in `SCORE_TIERS`, and that is the design
working rather than an omission.** It ships with a leaderboard and earns
`first-score`, `plays-*`, `days-*`, `top-ten` and `rank-one` from its first
submission, but has no score ladder of its own. Two consequences, both wanted:

- `all-three` / Arcade Tourist reads `Object.keys(SCORE_TIERS)` directly, so
  leaving Hivebreak out means nobody's in-progress badge silently got harder
  the day a fourth game shipped.
- `record_play` is keyed by `(user_id, game_id)` and knows nothing about the
  catalogue, so `player_stats` has been accumulating Hivebreak plays and bests
  since launch. Adding its three tiers later awards them retroactively.

That is precisely the case "a badge added later awards itself from counters
that have been accumulating all along" was built for. The alternative was
inventing three thresholds for a game with no players, which the paragraph
below explicitly forbids. Set them from `player_stats` once there is history.
`test/badges.test.js` already covers the shape of this — see *"awards no ladder
for a game it does not know"*.

**The per-game score thresholds are measured, not derived, and the derivation
is in the file.** Read from the live board 2026-08-15 and chosen so bronze and
silver sit in the 30–60% band and gold in 5–15%. The sample is the retained top
100, so it is survivorship-biased and counts rows rather than players — both
noted in-code. Revisit from `player_stats` once there is enough history to ask
the question per player. This is NOT a licence to invent the next number by
hand; Tetris's anti-cheat ceiling below is still the example of what that
produces.

## Anti-cheat

The client is untrusted. Obfuscation and WASM are not security. Clients never write
to the DB directly — only to an Edge Function holding the service role key. That
part holds today.

**The rest is not implemented.** There is still no session token, so
`session_duration_seconds` is client-supplied and trivially forged; every check
below raises the cost of cheating rather than preventing it.

Ceilings are now per-game, in a `GAMES` map in the function:

| Game | pts/sec | max score | Derived? |
|---|---|---|---|
| `snake` | 900 | 12,000 | Yes — grid size × move rate × apple value, shown in-code |
| `breakout` | 7,000 | 810,000 | Yes — max ball speed × brick height × capped multiplier, shown in-code |
| `tetris` | 5000 | 10,000,000 | **No.** Inherited from the single-game version. Still owed a derivation. |
| `hivebreak` | 10,000 | 800,000 | Yes — fire cooldown × barrels × top enemy value, and wave value × `MAX_STAGE`, shown in-code |

Do not copy another game's numbers, and do not treat Tetris's as a precedent —
it is the thing that needs fixing, not the pattern to follow.

Breakout's cap is only finite because two constants make it so: `MAX_LEVEL`
(99) and `SCORE_MULTIPLIER_CAP` (20), both in
`js/games/breakout/core/constants.js`. They exist for the derivation, not for
game design. Raise either and the Edge Function's `maxScore` is wrong.

Hivebreak has the same shape and more of them: `MAX_STAGE`, `FIRE_COOLDOWN_MS`,
`MAX_ENEMY_POINTS` and the formation shape itself
(`FORMATION_COLS` / `ROW_KINDS` / `BOSS_COLUMNS`) all feed its cap, and all are
flagged as load-bearing in `js/games/hivebreak/core/constants.js`. Adding one
row to the formation raises the maximum wave value and silently makes the
deployed ceiling too low — which rejects honest scores rather than failing
loudly.

Planned flow:
1. Client requests a signed session token at game start (server-stamped start time,
   server-signed).
2. Client submits score + token at game over.
3. Function verifies signature, computes true duration server-side, validates, inserts.

Validate in this order:
1. Schema/type — reject non-integers, `NaN`, negatives.
2. Points-per-second against a per-game ceiling.
3. Session duration bounds — absurdly short and absurdly long both rejected.

Per-game ceilings must be derived from the actual engine
(grid size × tick rate × max points per event) and documented in-code with that
derivation. Do not copy a number from a spec doc, and do not keep the current 5000 —
recompute it.

Log rejections with the payload and computed rate; don't silently drop.

Keep RLS on regardless — public `SELECT`, no `INSERT` policy for `anon` — as
defense-in-depth for any direct client path. But note service-role writes bypass RLS,
so the Edge Function is the real gate.

## UI/UX

- The canvas is the focal point. Surrounding chrome collapses or fades when a
  session starts.
- Show system status: "Syncing…" during score submission, explicit success/failure.
  No silent network operations.
- Buttons read as pressable — shadow, active-state transform. Pause reachable at all
  times via a visible icon and Escape.
- Prevent errors up front: if the user can't save a score, say so on the start
  screen, not after they've played.
- Label leaderboards "Global" vs "Local" explicitly. No dark patterns.
- Touch targets ≥48×48 CSS px, positioned in the lower screen quadrants near
  thumb rest.
- Every game page links back to the arcade hub.

## Accessibility & performance

- Semantic HTML (`<header> <main> <nav> <section>`).
- Everything outside the canvas is tab-navigable with a visible `:focus` state.
- Text contrast ≥4.5:1. Target WCAG 2.1 AA.
- No `innerHTML`. `js/shared/util/dom.js` deliberately offers no markup-parsing
  helper — `setText`/`el` are the only paths to the screen, so the ergonomic option
  is also the injection-safe one.
- **No inline `style` attributes. They do not work here.** Every page ships
  `style-src 'self'` with no `unsafe-inline`, and that directive also governs
  style attributes, so the browser drops them silently — no console error, just
  an unstyled element. `el(tag, { attrs: { style: '…' } })` goes through
  `setAttribute` and is therefore dead code. Measured 2026-07-28: an element
  given `style="width: 123px"` computed to the inherited width, while
  `element.style.width = '77px'` applied — CSP does not restrict CSSOM. Use
  classes; reach for `element.style.x =` only for genuinely dynamic values, as
  the renderers do for canvas sizing.
  This entry used to end by naming `js/games/tetris/ui/scoresView.js` and
  `js/games/tetris/pages/leaderboard.js` as still styling themselves inline and
  rendering unstyled in production. **That was fixed in a1722f8 ("Style
  Tetris's score screens with classes, not blocked inline styles") and this
  line was not updated with it.** Re-checked 2026-08-15: neither file contains
  a style attribute, and `attrs: { style: … }` appears nowhere under `js/`.
  The rule above stands; there is no longer a known violation of it.
- Lazy-load sprites and audio behind the menu; ship only the start-screen critical
  path first.
