/**
 * Tetris start, pause and game-over overlays — spec §11.
 *
 * The card mechanism (focus handling, focus trap, activation guard) is shared
 * in js/shared/ui/overlays.js; this supplies the Tetris copy and drives the
 * overlay from the Tetris FSM.
 */

import { createOverlayShell } from '../../../shared/ui/overlays.js';
import { STATES } from '../core/fsm.js';

const CONTROLS = [
  ['Move', '← →'],
  ['Soft / hard drop', '↓ / Space'],
  ['Rotate', '↑ or X / Z / A for 180°'],
  ['Hold', 'C or Shift'],
  ['Pause', 'P or Esc']
];

/** Overlays that appear right after gameplay, where a reflexive key is likely. */
const isTerminalKind = (kind) => /^gameover|^leaderboard/.test(kind);

export function createOverlays({ onAction }) {
  const shell = createOverlayShell({ onAction, isTerminalKind });
  const { open, close, button, link } = shell;

  const controlsText = CONTROLS.map(([name, keys]) => `${name}   ${keys}`).join('\n');

  return {
    showStart() {
      open('start', {
        title: 'Tetris',
        body: controlsText,
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
        body: controlsText,
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
        title: 'Game Over',
        body: `Score ${state.score.toLocaleString()}\n`
            + `Level ${state.level}   Lines ${state.lines}`,
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
