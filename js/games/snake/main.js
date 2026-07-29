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

import { ACTIONS } from './core/game.js';
import { STATES } from './core/fsm.js';
import { createEngine } from './engine/engine.js';
import { createKeyboard } from './input/keyboard.js';
import { isTextTarget } from '../../shared/input/keyboard.js';
import { createTouch } from './input/touch.js';
import { createPalette } from './render/palette.js';
import { createRenderer } from './render/renderer.js';
import { createHud } from './ui/hud.js';
import { createOverlays } from './ui/overlays.js';
import { createSettingsUI } from './ui/settings.js';
import { createScoresView } from './ui/scoresView.js';
import { loadSettings } from './storage/settingsStore.js';
import { createBackgrounds } from '../../shared/ui/background.js';
import { createA11y } from '../../shared/ui/a11y.js';
import { createHaptics } from '../../shared/input/haptics.js';
import { createSynth } from '../../shared/audio/synth.js';
import { createSfx } from './audio/sfx.js';
import { registerServiceWorker } from '../../shared/pwa.js';
import { qs, on } from '../../shared/util/dom.js';

registerServiceWorker();

const palette = createPalette();
const keyboard = createKeyboard();

const renderer = createRenderer({
  container: qs('#field-stack'),
  gridCanvas: qs('#grid-canvas'),
  playCanvas: qs('#play-canvas'),
  palette
});

const hud = createHud();

// The engine is built with the stored rules already applied, so the very first
// game honours them rather than playing one round at the defaults.
const booted = loadSettings();
const engine = createEngine({
  input: keyboard,
  speed: booted.speed,
  wrap: booted.wrap
});

const a11y = createA11y({ liveRegion: qs('#live-region') });
const backgrounds = createBackgrounds({
  canvasA: qs('#bg-a'),
  canvasB: qs('#bg-b')
});
const synth = createSynth();

function startNewGame() {
  engine.dispatch(ACTIONS.RESTART);
  hud.reset();
  overlays.close();
}

const overlays = createOverlays({
  getSettings: () => settingsUI.getSettings(),
  onAction(action) {
    switch (action) {
      case 'start':
      case 'restart':
        startNewGame();
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
  palette.refresh();

  // Speed and wrap are rules; the core applies them on the next start, not to
  // the run in progress.
  engine.configure({ speed: settings.speed, wrap: settings.wrap });
});

createSfx(engine, synth, settingsUI.getSettings);

// Touch is wired after settings so swipe gestures can honour the swipe toggle.
createTouch(engine, settingsUI.getSettings);

// Haptics are driven from engine events, so keyboard and touch feel the same.
const haptics = createHaptics(settingsUI.getSettings);
engine.on('turn', () => haptics.light());
engine.on('eat', () => haptics.medium());
engine.on('die', () => haptics.gameOver());

on(qs('#btn-pause'), 'click', () => engine.dispatch(ACTIONS.PAUSE));
on(qs('#btn-settings'), 'click', () => settingsUI.show());

/* --- render ---------------------------------------------------------------- */

engine.setRenderer((state, alpha) => {
  renderer.render(state, alpha);
  hud.update(state);
});

/* --- react to core events -------------------------------------------------- */

// The backdrop cycles every five apples. createBackgrounds indexes its four
// generators off whatever number it is handed, so "level" here just means
// "how far into the run" — no shared code needed to know about Snake.
let backdropTier = 1;

engine.on('eat', ({ apples }) => {
  const tier = Math.floor(apples / 5) + 1;
  if (tier !== backdropTier) {
    backdropTier = tier;
    backgrounds.drawLevel(tier);
  }
  if (apples > 0 && apples % 10 === 0) {
    hud.showBadge(`${apples} apples`);
    a11y.announce(`${apples} apples`);
  }
});

engine.on('die', ({ won, score }) => {
  a11y.announce(won ? 'Perfect game' : `Game over. Score ${score}`);
});

engine.on('changed', (state) => {
  const kind = overlays.kind;
  if (state.fsm === STATES.GAME_OVER
      && kind !== 'gameover' && kind !== 'gameover_new_highscore') {
    scoresView.showGameOver(state);
  } else if (state.fsm === STATES.PAUSED && kind !== 'paused' && kind !== 'settings') {
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

backgrounds.drawLevel(backdropTier);
overlays.showStart();
engine.start();

// Pressing Enter on the start or game-over screen should just play. Space is
// deliberately not bound: it also activates whatever button holds focus.
//
// The isTextTarget guard is load-bearing, not defensive. The game-over card
// focuses an initials field, and GAME_OVER is one of the states this shortcut
// fires in — so without it, pressing Enter to submit a high score restarted the
// run and threw the score away before it could be saved.
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
  if (isTextTarget(event.target)) return;
  const state = engine.getState();
  if (state.fsm === STATES.MENU || state.fsm === STATES.GAME_OVER) startNewGame();
});
