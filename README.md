# Arcade

A small browser arcade built in vanilla ES modules — no framework, no build step,
no dependencies. Games are playable on desktop and touch, install as a PWA, and
play offline.

Live: **https://aihealgenius.com/**

- **[Tetris](games/tetris/)** — Guideline-accurate, with three deliberate
  deviations (below).
- **[Snake](games/snake/)** — grid movement with four-way swipe control.
- **[Breakout](games/breakout/)** — pointer-driven paddle, 99 levels.

All three are playable. Each keeps a local high-score table and posts to a
global leaderboard; players can optionally create an account to claim a gamer
tag. The hub is at the repository root, each game lives under `games/<name>/`,
and GitHub Pages serves `main` at `/` directly — branch deploy, no build
workflow. The original single-file Tetris is kept as reference in
[`Tetris_v1/`](Tetris_v1/).

## Architecture

Two layers with one-way dependencies: **games may import from `shared/`;
`shared/` never imports from a game.**

```
index.html          the hub
games/<name>/       a game's pages
account/            sign in, create account, reset password
js/hub/             registry.js — the game list — and the hub renderer
js/shared/          game-agnostic: engine, render, input, storage, ui, audio,
                    account, net, util
js/games/<name>/    everything that knows the game's rules
sw.js               one service worker, scope '/', for the whole site
supabase/           migrations and Edge Functions for the backend
```

Adding a game is a directory under `games/`, a directory under `js/games/`, and
one entry in `js/hub/registry.js`. It must never require editing `js/shared/`.
That rule has been tested rather than asserted: Breakout was built without
touching a single file under `js/shared/`.

Shared modules take game-specific values as **arguments, not imports** —
`createLoop({ timestep })`, `createAutoRepeat({ das, arr })`,
`createScoresStore(key)` — and throw rather than defaulting, because a wrong tick
rate or a shared score key fails silently rather than loudly.

Within each game, `core/` is pure: no DOM, no `Math.random`, no clock. Randomness
and time are injected, so the same inputs always produce the same state. That is
what makes the logic unit-testable and frame-rate independent, and it is why the
test suite can assert that identical seeded games at 30, 60 and 144Hz reach
identical boards and scores. `render/` never mutates state; `engine/` drives the
shared fixed-timestep loop; `input/`, `ui/`, `audio/` and `storage/` are thin
bindings that give the shared primitives that game's vocabulary.

## Accounts and the leaderboard

Accounts are **optional**. Without one you enter three initials, exactly as
before; with one you claim a gamer tag, and scores posted under it are marked
verified on the board. One flag in the `submit-score` Edge Function flips gamer
tags from optional to required when the time comes.

- **Email + password, confirmed by a 6-digit code.** The email address is never
  public: it is not readable by any client, not attached to any score, never
  shown on a leaderboard, and it is deleted with the account. It is not,
  however, absent from the database — Supabase Auth stores it in `auth.users`,
  and the sign-up page says so rather than claiming otherwise.
- **Gamer tags are validated server-side**, in a `before-user-created` auth hook.
  Client-side checks are shape-only, because `auth.signUp` is a public endpoint
  and anything the browser enforces can be skipped by calling the API directly.
  The blocklist is two-tier to avoid the Scunthorpe problem — `Scunthorpe`,
  `analysis`, `Bassett` and `Pakistan` are all accepted names, and there are
  tests that say so.
- **A signed-in player's name comes from the database, never the request body.**
- **Top 100 per game**, pruned in Postgres. A global top 100 would make the board
  a contest between games rather than between players.
- Players can report a gamer tag for moderation. A blocklist is a speed bump;
  report-and-ban is the actual remedy.

Clients never write to the database directly — only to Edge Functions holding
the service-role key, which validate score, rate and session bounds against
per-game ceilings. **This raises the cost of cheating rather than preventing
it:** there is no signed session token yet, so `session_duration_seconds` is
client-supplied and forgeable. Treat the leaderboard as friendly, not
authoritative.

## Accessibility notes

Game pages disable pinch- and double-tap-zoom (`user-scalable=no`,
`maximum-scale=1`) so those gestures can't fire mid-game. This is a deliberate
game-UX trade against WCAG 1.4.4 (zoom to 200%); iOS Safari ignores it for
accessibility regardless. The hub, account, about and leaderboard pages are
ordinary documents and stay fully zoomable. Everything else targets WCAG AA —
contrast, focus visibility, 48px touch targets, screen-reader announcements,
`prefers-reduced-motion`, and no reliance on colour alone.

## Deviations from the Guideline

1. **Levelling every 5 lines, not 10.** A gameplay-feel choice so the difficulty
   curve bites sooner. See `levelFor` in `js/games/tetris/core/scoring.js`.
2. **180° rotation has wall kicks.** The Guideline mandates the key but defines
   no table; a kickless 180 is unusable in a real stack, so this adopts the
   Nullpomino / TETR.IO table as a documented extension. See `KICKS_180` in
   `js/games/tetris/core/kicks.js`.
3. **`file://` is not supported.** Native ES modules can't load from `file://`
   (CORS). The page shows an actionable message there instead of a blank screen;
   `Tetris_v1/index.html` remains the double-clickable version.

## Tests

Pure logic — all three games' cores, the shared loop, auto-repeat, canvas
geometry and the gamer-tag validator — is covered by a zero-dependency harness
that runs two ways with nothing installed:

```sh
node test/run-node.mjs      # terminal
# or open /test/ in the browser once a server is running
```

The gamer-tag validator is the same file the server runs. It is plain `.js` with
no imports specifically so Deno, Node and the browser all load it, and the tests
cover the code that actually enforces the rule.

`test/e2e-accounts.mjs` is separate and deliberately not part of that run: it
needs Docker and a local Supabase stack, and it writes to the database. It
covers what unit tests cannot reach — the auth hook firing inside the signup
transaction, the database's column-level grants, and account deletion.

```sh
supabase start
node test/e2e-accounts.mjs
```

Rendering, audio, touch and layout are **not** automated; they need manual QA,
including Windows display scaling at 125%/150% (fractional device pixel ratios)
and real-device mobile testing.

## Run locally

Native ES modules can't be opened over `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

The service worker is intentionally not registered on `localhost`, so local
edits are never masked by a stale cache. The Supabase client also switches to a
local backend on loopback, so a local page never writes to the live leaderboard.

## Deploying

GitHub Pages serves `main` at `/` on the custom domain in `CNAME`. Push to `main`
and it is live; there is no build step.

**Bump `CACHE` in `sw.js` whenever you change a cached asset.** Static assets are
served cache-first, so a stale cache name keeps serving old files to anyone who
has already visited.

Backend changes ship in a strict order — **schema, then Edge Functions, then the
client** — because `main` is served the moment it is pushed and a client that
queries a column the database does not have breaks every leaderboard at once.
Settings that live only in the Supabase dashboard are listed in
[`supabase/DASHBOARD.md`](supabase/DASHBOARD.md).

## Licence

**Proprietary — copyright © 2026 Lauri Suominen, all rights reserved.** See
[`LICENSE.md`](LICENSE.md). The repository is public because GitHub Pages on the
free plan requires it, not because the code is free to take. Reading it and
GitHub's own fork button are fine; copying, redistributing or deploying it is
not.
