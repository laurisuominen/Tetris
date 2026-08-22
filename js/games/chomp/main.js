/**
 * Composition root.
 *
 * The only module allowed to wire impure things together. It holds no game logic
 * of its own — it constructs the pieces, subscribes them to the engine's event
 * stream, and starts the loop.
 *
 * Dependency direction is strictly one-way:
 *   core <- engine <- main -> { render, input, audio, ui, storage }
 *
 * The one job specific to this game is combining THREE direction sources — keys,
 * a swipe, and the D-pad — into the single buffered direction core wants.
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
import { withMute } from '../../shared/audio/mute.js';
import { createMuteButton, bindMuteKey } from '../../shared/ui/muteButton.js';
import { registerServiceWorker } from '../../shared/pwa.js';
import { qs, on } from '../../shared/util/dom.js';

registerServiceWorker();

const palette = createPalette();
const keyboard = createKeyboard();
const fieldStack = qs('#field-stack');

const renderer = createRenderer({
  container: fieldStack,
  wallCanvas: qs('#wall-canvas'),
  playCanvas: qs('#play-canvas'),
  palette
});

const hud = createHud();

/* --- input ------------------------------------------------------------------ */

let touch = { dir: null };

/*
 * Touch wins when it has something to say, because its `dir` is READ-ONCE — a
 * swipe or a D-pad tap reports exactly once and then goes quiet. The keyboard is
 * level-triggered and reports for as long as a key is held, so it is the natural
 * fallback rather than a competitor. No last-used-wins arbitration is needed,
 * which is the one way this game is simpler than Breakout.
 */
const input = {
  consumeQueue: () => keyboard.consumeQueue(),
  get dir() {
    const tapped = touch.dir;
    if (tapped !== null && tapped !== undefined) return tapped;
    return keyboard.dir;
  }
};

/* --- engine ----------------------------------------------------------------- */

const booted = loadSettings();
const engine = createEngine({
  input,
  speed: booted.speed,
  modernAI: booted.modernAI
});

const a11y = createA11y({ liveRegion: qs('#live-region') });
const backgrounds = createBackgrounds({ canvasA: qs('#bg-a'), canvasB: qs('#bg-b') });
const synth = createSynth();

function startNewGame() {
  engine.dispatch(ACTIONS.RESTART);
  hud.reset();
  renderer.invalidateWalls();
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
  renderer.refresh();
  engine.configure({ speed: settings.speed, modernAI: settings.modernAI });
});

/*
 * Mute wraps the settings getter rather than touching audio/sfx.js: that
 * module already bails at volume 0, so `withMute` handing it a zeroed copy is
 * the entire mechanism. The player's own volume is left untouched underneath,
 * which is what makes unmuting restore the level they chose.
 */
createSfx(engine, synth, withMute(settingsUI.getSettings));
createMuteButton(qs('#btn-mute'));
bindMuteKey();

touch = createTouch(engine);

const haptics = createHaptics(settingsUI.getSettings);
engine.on('energizer', () => haptics.light());
engine.on('ghostEaten', () => haptics.light());
engine.on('fruitEaten', () => haptics.light());
engine.on('died', () => haptics.medium());
engine.on('gameOver', () => haptics.gameOver());

on(qs('#btn-pause'), 'click', () => engine.dispatch(ACTIONS.PAUSE));
on(qs('#btn-settings'), 'click', () => settingsUI.show());

/* --- render ----------------------------------------------------------------- */

engine.setRenderer((state, alpha) => {
  renderer.render(state, alpha);
  hud.update(state);
});

/* --- react to core events --------------------------------------------------- */

engine.on('levelStart', ({ level }) => {
  backgrounds.drawLevel(level);
  renderer.invalidateWalls();
  hud.showBadge(`Level ${level}`);
  a11y.announce(`Level ${level}`);
});

engine.on('extraLife', ({ lives }) => {
  hud.showBadge('Extra life');
  a11y.announce(`Extra life. ${lives} lives.`);
});

engine.on('fruitShown', ({ name }) => a11y.announce(`${name.toLowerCase()} bonus`));

engine.on('fruitEaten', ({ points }) => hud.showBadge(`+${points.toLocaleString()}`));

engine.on('ghostEaten', ({ points }) => hud.showBadge(`+${points}`));

engine.on('elroy', () => a11y.announce('Blinky speeds up'));

engine.on('died', ({ lives }) => {
  if (lives > 0) a11y.announce(`${lives} ${lives === 1 ? 'life' : 'lives'} left`);
});

engine.on('gameOver', ({ won, score }) => {
  a11y.announce(won ? 'Maze mastered' : `Game over. Score ${score}`);
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

// Enter plays from the start and game-over screens. The isTextTarget guard is
// load-bearing: the game-over card focuses an initials field, and GAME_OVER is
// one of the states this fires in, so without it Enter would restart the run and
// throw the score away before it could be saved.
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
  if (isTextTarget(event.target)) return;
  const state = engine.getState();
  if (state.fsm === STATES.MENU || state.fsm === STATES.GAME_OVER) startNewGame();
});
