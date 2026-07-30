/**
 * Breakout start, pause and game-over overlays.
 *
 * The card mechanism (focus handling, focus trap, activation guard) is shared
 * in js/shared/ui/overlays.js; this supplies the Breakout copy and drives the
 * overlay from the Breakout FSM.
 */

import { createOverlayShell } from '../../../shared/ui/overlays.js';
import { STATES } from '../core/fsm.js';
import { SPEED_TABLE } from '../core/constants.js';

const CONTROLS = [
  ['Move paddle', 'Mouse, ← →, or A D'],
  ['Launch', 'Space'],
  ['Pause', 'P or Esc'],
  ['Start', 'Enter']
];

/** Overlays that appear right after gameplay, where a reflexive key is likely. */
const isTerminalKind = (kind) => /^gameover|^leaderboard/.test(kind);

export function createOverlays({ onAction, getSettings = () => ({}) }) {
  const shell = createOverlayShell({ onAction, isTerminalKind });
  const { open, close, button, link } = shell;

  const controlsText = CONTROLS.map(([name, keys]) => `${name}   ${keys}`).join('\n');

  /** So the start screen states the rules it is about to play by. */
  function rulesLine() {
    const settings = getSettings();
    const speed = SPEED_TABLE[settings.speed]?.label ?? 'Classic';
    return `${speed} speed   ·   3 balls   ·   levels never stop`;
  }

  return {
    showStart() {
      open('start', {
        title: 'Breakout',
        body: `${controlsText}\n\n${rulesLine()}`,
        buttons: [
          button('Play', 'start'),
          button('Settings', 'settings', 'btn--ghost'),
          link('About', 'about/', 'btn--ghost'),
          link('Leaderboard', 'leaderboard/', 'btn--ghost'),
          link('Arcade', '../../', 'btn--ghost')
        ]
      });
    },

    showPaused() {
      open('paused', {
        title: 'Paused',
        body: `${controlsText}\n\n${rulesLine()}`,
        buttons: [
          button('Resume', 'resume'),
          button('Restart', 'restart', 'btn--ghost'),
          button('Settings', 'settings', 'btn--ghost'),
          link('About', 'about/', 'btn--ghost'),
          link('Leaderboard', 'leaderboard/', 'btn--ghost'),
          link('Arcade', '../../', 'btn--ghost')
        ]
      });
    },

    showGameOver(state) {
      open('gameover', {
        title: state.won ? 'Wall Cleared' : 'Game Over',
        body: `Score ${state.score.toLocaleString()}\nLevel ${state.level}`,
        buttons: [button('Play again', 'restart')]
      });
    },

    close,
    get isOpen() { return shell.isOpen; },
    get kind() { return shell.kind; },

    /** Drives the overlay purely from FSM state, so it can never disagree. */
    syncTo(state) {
      switch (state.fsm) {
        case STATES.MENU:      this.showStart(); break;
        case STATES.PAUSED:    this.showPaused(); break;
        case STATES.GAME_OVER: this.showGameOver(state); break;
        default:               if (shell.kind) close();
      }
    },

    open,
    button
  };
}
