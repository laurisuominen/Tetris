# Tetris v2

A modern, dependency-free Tetris built in vanilla ES modules, following the
Tetris Guideline closely with two deliberate, documented deviations (below).

## Architecture

The project is heavily decoupled into distinct layers to prioritize determinism and performance:
- **`js/core/`**: A pure functional state machine. Contains zero DOM manipulation, zero randomness (uses a seeded `mulberry32` PRNG for deterministic testing), and zero side effects. Given the same inputs, it produces the exact same game state.
- **`js/engine/`**: The orchestrator. Manages the fixed-timestep loop, applies inputs, and dispatches events.
- **`js/render/`**: A highly optimized multi-layer canvas renderer. Avoids redrawing static layers (like the locked board) every frame by splitting the scene across three stacked `<canvas>` elements (board, active piece, effects).
- **`js/ui/`**: Clean DOM wrappers and overlays for settings, high scores, backgrounds, and accessibility (`aria-live`).
- **`js/audio/`**: A lightweight procedurally generated Web Audio synthesizer for SFX. Zero asset loading needed.

## Features
- **Accurate mechanics**: SRS kicks (including 180°), lock delay, T-Spins (Mini vs Full), combo system, Back-to-Back, and the 7-bag randomizer.
- **Accessible**: Keyboard controls, Touch gestures (swipes), Screen-reader announcements via `aria-live`, and `prefers-reduced-motion` OS support.
- **Performant**: Built to run smoothly at 60fps on mobile via lazy rendering and separated canvases.
- **Persistent**: Secure LocalStorage wrappers for settings (Motion, Classic Colors, Ghost Piece) and high scores.
- **Polished**: Procedurally generated, deterministic backgrounds that smoothly crossfade on level up.

## Deviations from the spec

Three, all intentional:

1. **Levelling every 5 lines, not 10.** Spec §9 says every 10. Levelling twice as
   fast makes the difficulty curve bite sooner and stops a casual session
   plateauing. See `levelFor` in `js/core/scoring.js`.
2. **180° rotation has wall kicks.** Spec §10 mandates a 180° key but §4 gives no
   kick table, because the Guideline defines none. A kickless 180 fails against
   any adjacent surface and is unusable in a real stack, so this adopts the
   Nullpomino / TETR.IO table. See `KICKS_180` in `js/core/kicks.js`.
3. **`file://` is not supported**, superseding acceptance criterion §12.1. Native
   ES modules are fetched under CORS rules and `file://` origins are opaque, so
   every import fails before any code runs. Opening the page over `file://`
   shows an actionable message rather than a blank screen. `Tetris_v1/index.html`
   remains the double-clickable version.

## Tests

Pure logic (core, auto-repeat, canvas geometry) is covered by a zero-dependency
harness that runs two ways with nothing installed:

```sh
node test/run-node.mjs   # terminal
# or open /test/ in the browser once the server is running
```

The headline case asserts frame-rate independence — identical seeded games at
30, 60 and 144Hz must reach identical boards and scores, which is spec
acceptance criterion §12.9 as a test rather than a manual eyeball.

Rendering, audio, touch gestures and layout are **not** automated; they need
manual QA, including Windows display scaling at 125% and 150% where fractional
device pixel ratios are most likely to show seams between blocks.

## How to run locally

Because it is built entirely with native ES modules, you cannot simply open `index.html` from the `file://` protocol due to browser CORS policies.

Serve it locally using any static web server. For example:

```sh
# Using npx
npx serve .

# Or using python
python3 -m http.server
```

Then navigate to the provided localhost URL in your browser.
