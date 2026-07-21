# Tetris

A modern, dependency-free Tetris built in vanilla ES modules — no framework, no
build step. It is fully playable on desktop and touch, installs as a PWA, and
plays offline. It follows the Tetris Guideline closely, with two deliberate,
documented deviations (below).

Live: **https://laurisuominen.github.io/Tetris/**

The game lives at the repository root so GitHub Pages serves it at the base URL;
a small CI workflow (`.github/workflows/deploy.yml`) publishes a clean copy of
the root on every push to `main`. The previous single-file version is kept as
reference in [`Tetris_v1/`](Tetris_v1/) and is not published.

## Architecture

Heavily decoupled, one-way dependencies (`core ← engine ← main → everything`):

- **`js/core/`** — pure functional game logic. No DOM, no `Math.random`, no
  clock; randomness and time are injected, so the same inputs always produce the
  same state. This is what makes it unit-testable and frame-rate independent.
- **`js/engine/`** — the fixed-timestep loop and event orchestrator.
- **`js/render/`** — a multi-layer canvas renderer that only repaints layers
  that changed (the locked stack is not redrawn every frame), with device-pixel
  snapping for crisp blocks at fractional display scales.
- **`js/input/`** — `keyboard`, `touch` (on-screen controls + swipe), `autorepeat`
  (shared DAS/ARR), and `haptics`. Input never mutates state; it enqueues or
  dispatches actions.
- **`js/ui/`** — overlays, HUD, settings, scores, procedural backgrounds, and an
  `aria-live` announcer.
- **`js/audio/`** — a procedural Web Audio synth (no asset files).
- **`js/storage/`** — validated `localStorage` wrappers for settings and scores.
- **`sw.js` / `manifest.json` / `js/pwa.js`** — the PWA shell.

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
- **Installable & offline** — standalone PWA with a service worker that caches
  the game for offline play.
- **Persistent** — settings and a local high-score table, with a standalone
  [leaderboard](leaderboard/) and [about](about/) page sharing the same data.
- **Accessible** — full keyboard control, visible focus rings, screen-reader
  announcements, and `prefers-reduced-motion` support.

## Accessibility notes

The viewport disables pinch- and double-tap-zoom (`user-scalable=no`,
`maximum-scale=1`) so those gestures can't fire mid-game. This is a deliberate
game-UX trade against WCAG 1.4.4 (zoom to 200%); iOS Safari ignores it for
accessibility regardless. Everything else targets WCAG AA — contrast, focus
visibility, 48px touch targets, and no reliance on colour alone (clear types are
labelled in text).

## Deviations from the Guideline

1. **Levelling every 5 lines, not 10.** A gameplay-feel choice so the difficulty
   curve bites sooner. See `levelFor` in `js/core/scoring.js`.
2. **180° rotation has wall kicks.** The Guideline mandates the key but defines
   no table; a kickless 180 is unusable in a real stack, so this adopts the
   Nullpomino / TETR.IO table. See `KICKS_180` in `js/core/kicks.js`.
3. **`file://` is not supported.** Native ES modules can't load from `file://`
   (CORS). The page shows an actionable message there instead of a blank screen;
   `Tetris_v1/index.html` remains the double-clickable version.

## Tests

Pure logic (core, auto-repeat, canvas geometry) is covered by a zero-dependency
harness that runs two ways with nothing installed:

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
python -m http.server 8000
# then open http://localhost:8000
```

The service worker is intentionally not registered on `localhost`, so local
edits are never masked by a stale cache.
