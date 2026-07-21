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
import { createSettingsUI } from './ui/settings.js';
import { createScoresView } from './ui/scoresView.js';
import { createBackgrounds } from './ui/background.js';
import { createA11y } from './ui/a11y.js';
import { createTouch } from './input/touch.js';
import { createHaptics } from './input/haptics.js';
import { createSynth } from './audio/synth.js';
import { createSfx } from './audio/sfx.js';
import { registerServiceWorker } from './pwa.js';
import { qs, setText, on } from './util/dom.js';

registerServiceWorker();

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

const a11y = createA11y({ liveRegion });
const backgrounds = createBackgrounds({
  canvasA: qs('#bg-a'),
  canvasB: qs('#bg-b')
});
const synth = createSynth();

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
      case 'scores':
        scoresView.showLeaderboardOnly();
        break;
      case 'settings':
        settingsUI.show();
        break;
      default:
        break;
    }
  }
});

const scoresView = createScoresView(overlays);

const settingsUI = createSettingsUI(overlays, (settings) => {
  document.documentElement.setAttribute('data-motion', settings.motion);
  document.documentElement.setAttribute('data-palette', settings.classicColors ? 'classic' : 'default');
  document.documentElement.style.setProperty('--ghost-fill-alpha', settings.ghostPiece ? '0.10' : '0');
  document.documentElement.style.setProperty('--ghost-stroke-alpha', settings.ghostPiece ? '0.55' : '0');
  
  palette.refresh();
  previews.invalidate();
  renderer.invalidateBoard(); // ensures layers redraw with new colors
});

createSfx(engine, synth, settingsUI.getSettings);

// Touch is wired after settings so swipe gestures can honour the swipe toggle.
createTouch(engine, settingsUI.getSettings);

// Haptics are driven from engine events, so keyboard and touch feel the same.
const haptics = createHaptics(settingsUI.getSettings);
engine.on('move', () => haptics.light());
engine.on('rotate', () => haptics.light());
engine.on('hold', () => haptics.light());
engine.on('hardDrop', () => haptics.hardDrop());
engine.on('clear', ({ lines }) => { if (lines > 0) haptics.medium(); });
engine.on('levelUp', () => haptics.light());
engine.on('topOut', () => haptics.gameOver());

on(qs('#btn-pause'), 'click', () => {
  engine.dispatch(ACTIONS.PAUSE);
});

on(qs('#btn-settings'), 'click', () => {
  settingsUI.show();
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
  if (label) a11y.announce(label);
});

engine.on('levelUp', ({ level }) => {
  hud.flashLevel();
  a11y.announce(`Level ${level}`);
  backgrounds.drawLevel(level);
});

engine.on('topOut', () => {
  a11y.announce('Game over');
});

engine.on('changed', (state) => {
  if (state.fsm === STATES.GAME_OVER && overlays.kind !== 'gameover' && overlays.kind !== 'gameover_new_highscore') {
    scoresView.showGameOver(state);
  } else if (state.fsm === STATES.PAUSED && overlays.kind !== 'paused' && overlays.kind !== 'settings') {
    overlays.showPaused();
  }
});

engine.on('pause', ({ paused, state }) => {
  if (paused) {
    if (overlays.kind !== 'settings') overlays.showPaused();
  } else if (state.fsm === STATES.PLAYING) {
    overlays.close();
  }
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
