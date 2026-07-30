# CLAUDE.md

Browser-based casual arcade (Tetris now; Snake and Breakout planned) on GitHub
Pages, with a Supabase backend for the global leaderboard. These are project
standards — follow them on every task.

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
  If you find yourself wanting another exception, the bar is "shared code cannot
  express this at all", not "this would be convenient".
- Existing tests. Don't delete, skip, or loosen an assertion to make a suite green;
  if a test is wrong, say so and stop.

No new runtime dependencies without asking first. Dev dependencies: ask if it changes
the build. No force-push, no rewriting published history. One logical change per commit.

## Architecture

```
index.html          arcade hub (the game picker)
games/<name>/       one directory per game: index.html and its sub-pages
css/                tokens.css is the shared design system; hub.css, pages.css
js/
  hub/              registry.js (the game list) + hub.js
  shared/           game-agnostic modules — do not edit to add a game
    engine/         createLoop (fixed timestep, injected), clock
    render/         dpr, geometry (grid-size agnostic)
    input/          keyboard, touch, autorepeat, haptics
    storage/        storage, createScoresStore(key)
    ui/             overlay shell, a11y announcer, procedural backgrounds
    audio/          synth
    net/            leaderboard — the ONLY module that talks to the network
    util/           dom, emitter, rng
  games/<name>/     one directory per game, mirroring the shared layout
                    tetris/ and snake/ both exist; use snake/ as the reference
                    for a new game, it is the one built against these rules
sw.js               ONE service worker, scope '/', covering the whole site
supabase/
  functions/        Edge Functions (submit-score)
  migrations/       SQL
```

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
`CNAME`. There is no build workflow: what is on `main` is what is served, including
`Tetris_v1/` and `test/`.

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
Edge Function, which validates `game_id` against an allowlist. Two games write to
it: `tetris` and `snake`.

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
- *Planned* — prune with `pg_cron` on a nightly schedule, never with row triggers.
  Delete on the FULL key — **deleting on `id` alone is a data-loss bug**, `id` is not
  unique across partitions. A window function cannot appear in `WHERE`, so rank in a
  CTE and filter outside it:

```sql
WITH ranked AS (
  SELECT id,
         game_id,
         ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY score DESC) AS rn
  FROM leaderboard
)
DELETE FROM leaderboard l
USING ranked r
WHERE r.rn > 100
  AND l.id = r.id
  AND l.game_id = r.game_id;
```

- PgBouncer in transaction mode. Assume bursty concurrent session-end traffic.

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
| `tetris` | 5000 | 10,000,000 | **No.** Inherited from the single-game version. Still owed a derivation. |

Do not copy Snake's numbers for a new game, and do not treat Tetris's as a
precedent — it is the thing that needs fixing, not the pattern to follow.

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
  `js/games/tetris/ui/scoresView.js` and `js/games/tetris/pages/leaderboard.js`
  still style themselves inline and are rendering unstyled in production.
- Lazy-load sprites and audio behind the menu; ship only the start-screen critical
  path first.
