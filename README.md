# Arcade

A small browser arcade built in vanilla ES modules — no framework, no build step,
no dependencies. Games are playable on desktop and touch, install as a PWA, and
play offline.

Live: **https://aihealgenius.com/**

- **[Tetris](games/tetris/)** — Guideline-accurate, with two deliberate deviations
  (below). Playable.
- **Snake**, **Breakout** — listed on the hub as coming soon; not yet implemented.

The hub is at the repository root, each game lives under `games/<name>/`, and
GitHub Pages serves `main` at `/` directly (branch deploy — there is no build
workflow). The original single-file Tetris is kept as reference in
[`Tetris_v1/`](Tetris_v1/).

## Architecture

Two-layer split with one-way dependencies: **games may import from `shared/`;
`shared/` never imports from a game.**

```
index.html          the hub
games/<name>/       a game's pages
js/hub/             registry.js — the game list — and the hub renderer
js/shared/          game-agnostic: engine, render, input, storage, ui, audio,
                    net, util
js/games/<name>/    everything that knows the game's rules
sw.js               one service worker, scope '/', for the whole site
```

Adding a game is a directory under `games/`, a directory under `js/games/`, and one
entry in `js/hub/registry.js`. It never requires editing `js/shared/`.

Shared modules take game-specific values as **arguments, not imports** —
`createLoop({ timestep })`, `createAutoRepeat({ das, arr })`,
`createScoresStore(key)` — and throw rather than defaulting, because a wrong tick
rate or a shared score key fails silently rather than loudly.

Within `js/games/tetris/`:

- **`core/`** — pure functional game logic. No DOM, no `Math.random`, no clock;
  randomness and time are injected, so the same inputs always produce the same
  state. This is what makes it unit-testable and frame-rate independent.
- **`engine/`** — the event orchestrator, driving the shared fixed-timestep loop.
- **`render/`** — a multi-layer canvas renderer that only repaints layers that
  changed (the locked stack is not redrawn every frame), with device-pixel snapping
  for crisp blocks at fractional display scales.
- **`input/`, `ui/`, `audio/`, `storage/`** — thin bindings that give the shared
  keyboard, touch, overlay, synth and storage primitives their Tetris vocabulary.

## Features

- **Guideline mechanics** — SRS wall kicks (including 180°), lock delay with
  move-reset cap, T-spins (mini vs full), back-to-back, ghost piece, hold, and a
  7-bag randomizer.
- **Mobile-first** — responsive `dvh`/`svh` layout that never scrolls, a
  thumb-reachable control panel with ≥48px targets, low-latency
  `touchstart`/`touchend` handling, and optional swipe gestures (drag to move,
  tap to rotate, flick down to hard-drop).
- **Haptics** — Vibration API feedback on move/rotate/clear/hard-drop/game-over,
  toggleable, no-op where unsupported.
- **Installable & offline** — the arcade installs as one standalone PWA; a service
  worker caches each game as you visit it.
- **Persistent** — settings and a local high-score table, plus a global leaderboard
  backed by a Supabase Edge Function.
- **Accessible** — full keyboard control, visible focus rings, screen-reader
  announcements, and `prefers-reduced-motion` support.

## Accessibility notes

Game pages disable pinch- and double-tap-zoom (`user-scalable=no`,
`maximum-scale=1`) so those gestures can't fire mid-game. This is a deliberate
game-UX trade against WCAG 1.4.4 (zoom to 200%); iOS Safari ignores it for
accessibility regardless. The hub, about and leaderboard pages are ordinary
documents and stay fully zoomable. Everything else targets WCAG AA — contrast,
focus visibility, 48px touch targets, and no reliance on colour alone (clear types
are labelled in text).

## Deviations from the Guideline

1. **Levelling every 5 lines, not 10.** A gameplay-feel choice so the difficulty
   curve bites sooner. See `levelFor` in `js/games/tetris/core/scoring.js`.
2. **180° rotation has wall kicks.** The Guideline mandates the key but defines
   no table; a kickless 180 is unusable in a real stack, so this adopts the
   Nullpomino / TETR.IO table. See `KICKS_180` in `js/games/tetris/core/kicks.js`.
3. **`file://` is not supported.** Native ES modules can't load from `file://`
   (CORS). The page shows an actionable message there instead of a blank screen;
   `Tetris_v1/index.html` remains the double-clickable version.

## Tests

Pure logic (Tetris core, the shared loop, auto-repeat, canvas geometry) is covered
by a zero-dependency harness that runs two ways with nothing installed:

```sh
node test/run-node.mjs      # terminal
# or open /test/ in the browser once a server is running
```

The headline case asserts frame-rate independence — identical seeded games at
30, 60 and 144Hz reach identical boards and scores.

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
edits are never masked by a stale cache.

## Deploying

GitHub Pages serves `main` at `/` on the custom domain in `CNAME`. Push to `main`
and it is live; there is no build step.

**Bump `CACHE` in `sw.js` whenever you change a cached asset.** Static assets are
served cache-first, so a stale cache name keeps serving old files to anyone who has
already visited.
