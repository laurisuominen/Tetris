# Tetris v2

A modern, dependency-free, strictly Guideline-accurate Tetris built in vanilla ES modules.

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
