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
 *
 * The one job here that the other two games do not have is INPUT ARBITRATION.
 * Breakout takes a paddle position from three places at once — a pointer on the
 * board, held arrow keys, and on-screen arrow buttons — and blending them gives
 * a paddle that fights whichever hand is not moving. See createInput below.
 */

import { ACTIONS } from './core/game.js';
import { STATES } from './core/fsm.js';
import { COLS } from './core/constants.js';
import { createEngine } from './engine/engine.js';
import { createKeyboard } from './input/keyboard.js';
import { isTextTarget } from '../../shared/input/keyboard.js';
import { createTouch } from './input/touch.js';
import { createPointer } from './input/pointer.js';
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
const fieldStack = qs('#field-stack');

const renderer = createRenderer({
  container: fieldStack,
  bricksCanvas: qs('#bricks-canvas'),
  playCanvas: qs('#play-canvas'),
  palette
});

const hud = createHud();

/* --- input arbitration ------------------------------------------------------ */

/*
 * Last-used wins.
 *
 * A pointer reports an absolute target; keys and buttons report a direction.
 * Feeding both to core at once means an idle pointer keeps yanking the paddle
 * back to where the mouse happens to be resting while the player is trying to
 * steer with the keys — the classic version of this bug.
 *
 * So exactly one of the two is live at a time. Moving the pointer claims
 * control; pressing a key or an arrow button takes it back. `pointer` is
 * therefore null whenever the keyboard is in charge, which is precisely the
 * contract core expects.
 */
const pointer = createPointer({
  element: fieldStack,
  onMove() { usingPointer = true; }
});

let usingPointer = false;
let touchAxis = { axis: 0 };

const input = {
  consumeQueue: () => keyboard.consumeQueue(),

  get axis() {
    const axis = keyboard.axis || touchAxis.axis;
    if (axis !== 0) usingPointer = false;
    return axis;
  },

  get pointer() {
    if (!usingPointer) return null;
    if (!settingsUI.getSettings().pointerControls) return null;
    const fraction = pointer.fraction;
    return fraction === null ? null : fraction * COLS;
  }
};

/* --- engine ----------------------------------------------------------------- */

// The engine is built with the stored rules already applied, so the very first
// game honours them rather than playing one round at the defaults.
const booted = loadSettings();
const engine = createEngine({ input, speed: booted.speed });

const a11y = createA11y({ liveRegion: qs('#live-region') });
const backgrounds = createBackgrounds({
  canvasA: qs('#bg-a'),
  canvasB: qs('#bg-b')
});
const synth = createSynth();

function startNewGame() {
  engine.dispatch(ACTIONS.RESTART);
  hud.reset();
  renderer.invalidateBricks();
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
  renderer.invalidateBricks();   // the palette may have changed under it

  // Speed is a rule; the core applies it on the next start, not to the run in
  // progress.
  engine.configure({ speed: settings.speed });

  // Turning the pointer off mid-game must hand control back immediately rather
  // than at the next keypress.
  if (!settings.pointerControls) {
    usingPointer = false;
    pointer.release();
  }
});

createSfx(engine, synth, settingsUI.getSettings);

// Touch is wired after settings so the button panel exists before anything
// reads its axis.
touchAxis = createTouch(engine);

// Haptics are driven from engine events, so every input feels the same.
const haptics = createHaptics(settingsUI.getSettings);
engine.on('brick', () => haptics.light());
engine.on('bounce', ({ surface }) => { if (surface === 'paddle') haptics.light(); });
engine.on('lifeLost', () => haptics.medium());
engine.on('gameOver', () => haptics.gameOver());

on(qs('#btn-pause'), 'click', () => engine.dispatch(ACTIONS.PAUSE));
on(qs('#btn-settings'), 'click', () => settingsUI.show());

/* --- render ----------------------------------------------------------------- */

engine.setRenderer((state, alpha) => {
  renderer.render(state, alpha);
  hud.update(state);
});

/* --- react to core events --------------------------------------------------- */

// The wall layer only repaints when it changes, so every change has to say so.
engine.on('brick', () => renderer.invalidateBricks());
engine.on('levelStart', () => renderer.invalidateBricks());
engine.on('start', () => renderer.invalidateBricks());

// The backdrop cycles with the level. createBackgrounds indexes its four
// generators off whatever number it is handed, so no shared code needs to know
// Breakout exists.
engine.on('levelStart', ({ level }) => {
  backgrounds.drawLevel(level);
  hud.showBadge(`Level ${level}`);
  a11y.announce(`Level ${level}`);
});

engine.on('brokeThrough', () => {
  hud.showBadge('Broke through — paddle halved');
  a11y.announce('Broke through. Paddle halved.');
});

engine.on('lifeLost', ({ lives }) => {
  if (lives > 0) a11y.announce(`${lives} ${lives === 1 ? 'ball' : 'balls'} left`);
});

engine.on('gameOver', ({ won, score }) => {
  a11y.announce(won ? 'Wall cleared' : `Game over. Score ${score}`);
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

/* --- boot ------------------------------------------------------------------- */

backgrounds.drawLevel(1);
overlays.showStart();
engine.start();

// Pressing Enter on the start or game-over screen should just play.
//
// The isTextTarget guard is load-bearing, not defensive. The game-over card
// focuses an initials field, and GAME_OVER is one of the states this shortcut
// fires in — so without it, pressing Enter to submit a high score restarted the
// run and threw the score away before it could be saved.
//
// Space is NOT handled here: it is mapped to LAUNCH through the ordinary
// keymap, and binding it at the window as well would double-fire against any
// focused button that Space also activates.
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
  if (isTextTarget(event.target)) return;
  const state = engine.getState();
  if (state.fsm === STATES.MENU || state.fsm === STATES.GAME_OVER) startNewGame();
});
