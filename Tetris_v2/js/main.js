/**
 * Composition root.
 *
 * The only module allowed to wire impure things together. It holds no game
 * logic of its own — it constructs the pieces, subscribes them to the engine's
 * event stream, and starts the loop.
 *
 * Dependency direction is strictly one-way:
 *   core <- engine <- main -> { render, input, audio, ui, storage }
 * Nothing in core/ imports from any other top-level directory.
 */

import { LINE_CLEAR_MS } from './core/constants.js';
import { ACTIONS } from './core/game.js';
import { STATES } from './core/fsm.js';
import { createEngine } from './engine/engine.js';
import { createKeyboard } from './input/keyboard.js';
import { createPalette } from './render/palette.js';
import { createRenderer } from './render/renderer.js';
import { createPreviews } from './render/previews.js';
import { createHud } from './ui/hud.js';
import { createOverlays } from './ui/overlays.js';
import { qs, setText } from './util/dom.js';

const palette = createPalette();
const keyboard = createKeyboard();

const renderer = createRenderer({
  container: qs('#field-stack'),
  boardCanvas: qs('#board-canvas'),
  pieceCanvas: qs('#piece-canvas'),
  fxCanvas: qs('#fx-canvas'),
  palette
});

const previews = createPreviews({
  holdCanvas: qs('#hold-canvas'),
  nextCanvas: qs('#next-canvas'),
  palette
});

const hud = createHud();
const engine = createEngine({ input: keyboard });
const liveRegion = qs('#live-region');

const overlays = createOverlays({
  onAction(action) {
    switch (action) {
      case 'start':
      case 'restart':
        engine.dispatch(ACTIONS.RESTART);
        hud.reset();
        previews.invalidate();
        renderer.clearEffects();
        overlays.close();
        break;
      case 'resume':
        engine.dispatch(ACTIONS.RESUME);
        overlays.close();
        break;
      default:
        break;
    }
  }
});

/* --- render ---------------------------------------------------------------- */

engine.setRenderer((state) => {
  renderer.render(state);
  previews.render(state, engine.getNextPieces());
  hud.update(state);
});

// Resizing clears every canvas backing store, so the cached preview draws are
// stale and must be redrawn even though their contents did not change.
window.addEventListener('resize', () => previews.invalidate());

/* --- react to core events -------------------------------------------------- */

engine.on('lock', ({ cells }) => renderer.addLockEffect(cells));

engine.on('clear', ({ rows, label }) => {
  if (rows.length) {
    renderer.addClearEffect(rows, LINE_CLEAR_MS);
    // The stack now shows the rows mid-clear, so the cached draw is stale.
    renderer.invalidateBoard();
  }
  hud.showBadge(label);
  if (label) setText(liveRegion, label);
});

engine.on('levelUp', ({ level }) => {
  hud.flashLevel();
  setText(liveRegion, `Level ${level}`);
});

engine.on('topOut', () => {
  setText(liveRegion, 'Game over');
});

engine.on('changed', (state) => {
  if (state.fsm === STATES.GAME_OVER && overlays.kind !== 'gameover') {
    overlays.showGameOver(state);
  } else if (state.fsm === STATES.PAUSED && overlays.kind !== 'paused') {
    overlays.showPaused();
  }
});

engine.on('pause', ({ paused, state }) => {
  if (paused) overlays.showPaused();
  else if (state.fsm === STATES.PLAYING) overlays.close();
});

/* --- boot ------------------------------------------------------------------ */

overlays.showStart();
engine.start();

// Pressing Enter or Space on the start screen should just play.
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
  const state = engine.getState();
  if (state.fsm === STATES.MENU || state.fsm === STATES.GAME_OVER) {
    overlays.close();
    engine.dispatch(ACTIONS.RESTART);
    hud.reset();
    previews.invalidate();
    renderer.clearEffects();
  }
});
