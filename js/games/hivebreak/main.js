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
 * Two jobs here are specific to this game: INPUT ARBITRATION between a drag and
 * the keys (the same problem Breakout has, with a different resolution), and
 * deciding when the trigger is down, which now has three possible sources.
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
import { createSprites } from './render/sprites.js';
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
const sprites = createSprites(palette);
const keyboard = createKeyboard();
const fieldStack = qs('#field-stack');

const renderer = createRenderer({
  container: fieldStack,
  canvas: qs('#play-canvas'),
  palette,
  sprites
});

const hud = createHud();

/* --- input arbitration ------------------------------------------------------ */

/*
 * Last-used wins, the same rule Breakout settled on and for the same reason: a
 * drag and a held key both want to own the ship's x, and blending them gives a
 * ship that fights whichever hand is not moving.
 *
 * The DIFFERENCE from Breakout is what the pointer reports. Breakout's is
 * absolute — the paddle goes exactly where you point. Here it is relative, so
 * `pointer.fraction` is the position the drag has accumulated to rather than
 * where the finger is. That is what lets a thumb rest at the bottom-left of a
 * portrait screen and still fly the ship across the whole field, without the
 * hand covering the formation.
 */
const pointer = createPointer({
  element: fieldStack,
  onMove() { usingPointer = true; }
});

let usingPointer = false;
let touch = { axis: 0, firing: false };

const input = {
  consumeQueue: () => keyboard.consumeQueue(),

  get axis() {
    const axis = keyboard.axis || touch.axis;
    if (axis !== 0) usingPointer = false;
    return axis;
  },

  get pointer() {
    if (!usingPointer) return null;
    if (!settingsUI.getSettings().pointerControls) return null;
    const fraction = pointer.fraction;
    return fraction === null ? null : fraction * COLS;
  },

  /*
   * Three sources, any of which counts. Auto-fire is a setting rather than a
   * mode: the gun's cooldown is identical either way, so it costs the player
   * nothing but a cramped thumb to leave it off.
   */
  get firing() {
    if (settingsUI.getSettings().autoFire) return true;
    return keyboard.firing || touch.firing;
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

  // Colours are baked INTO the sprite canvases, so a theme change has to
  // repaint the art as well as refresh the palette. This is the one cost of
  // baking, and forgetting it leaves the ships in the old theme's colours.
  renderer.refresh();

  // Difficulty is a rule; the core applies it on the next start, not to the
  // run in progress.
  engine.configure({ speed: settings.speed });

  // Turning drag off mid-game must hand control back immediately rather than
  // at the next keypress.
  if (!settings.pointerControls) {
    usingPointer = false;
    pointer.release();
  }
});

createSfx(engine, synth, settingsUI.getSettings);

// Touch is wired after settings so the button panel exists before anything
// reads its axis.
touch = createTouch(engine);

// Haptics are driven from engine events, so every input feels the same.
const haptics = createHaptics(settingsUI.getSettings);
engine.on('kill', () => haptics.light());
engine.on('rescued', () => haptics.medium());
engine.on('captured', () => haptics.medium());
engine.on('shipHit', () => haptics.medium());
engine.on('gameOver', () => haptics.gameOver());

on(qs('#btn-pause'), 'click', () => engine.dispatch(ACTIONS.PAUSE));
on(qs('#btn-settings'), 'click', () => settingsUI.show());

/* --- render ----------------------------------------------------------------- */

engine.setRenderer((state, alpha) => {
  renderer.render(state, alpha);
  hud.update(state);
});

/* --- react to core events --------------------------------------------------- */

// The backdrop cycles with the stage. createBackgrounds indexes its four
// generators off whatever number it is handed, so no shared code needs to know
// Hivebreak exists.
engine.on('stageStart', ({ stage }) => {
  backgrounds.drawLevel(stage);
  hud.showBadge(`Stage ${stage}`);
  a11y.announce(`Stage ${stage}`);
});

engine.on('beamOpen', () => {
  hud.showBadge('Tractor beam');
  a11y.announce('Tractor beam');
});

engine.on('captured', ({ lives }) => {
  hud.showBadge('Ship captured');
  a11y.announce(`Ship captured. ${lives} left. Shoot the captor while it dives to get it back.`);
});

engine.on('rescued', () => {
  hud.showBadge('Dual fighter');
  a11y.announce('Ship rescued. Dual fighter.');
});

engine.on('captiveLost', () => {
  a11y.announce('Captured ship destroyed.');
});

engine.on('shipHit', ({ lives }) => {
  if (lives > 0) a11y.announce(`${lives} ${lives === 1 ? 'ship' : 'ships'} left`);
});

engine.on('gameOver', ({ won, score }) => {
  a11y.announce(won ? 'Hive cleared' : `Game over. Score ${score}`);
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
// The isTextTarget guard is load-bearing, not defensive: the game-over card
// focuses an initials field, and GAME_OVER is one of the states this fires in,
// so without it Enter would restart the run and throw the score away before it
// could be saved.
//
// Space is NOT handled here — it is the trigger, bound through the ordinary
// keymap, and binding it at the window as well would double-fire against any
// focused button that Space also activates.
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
  if (isTextTarget(event.target)) return;
  const state = engine.getState();
  if (state.fsm === STATES.MENU || state.fsm === STATES.GAME_OVER) startNewGame();
});
