/**
 * Game-over card: initials entry, then the two leaderboards.
 *
 * Classed elements only, no inline style attributes. This page ships
 * `style-src 'self'` with no unsafe-inline, which governs style="" as well as
 * <style>, so inline styling is dropped by the browser with no console error —
 * the card just renders unstyled. `el()` writes attributes through
 * setAttribute, so `attrs: { style: … }` never had any effect here.
 *
 * The classes live in css/components.css alongside the overlay they sit in.
 */

import { el, setText, on } from '../../../shared/util/dom.js';
import { isHighScore, saveScore, loadScores } from '../storage/scoresStore.js';
import { fetchTopScores, submitScore } from '../../../shared/net/leaderboard.js';

import { getSession } from '../../../shared/net/auth.js';
import { getCachedProfile, clearCachedProfile } from '../../../shared/account/session.js';

const GAME_ID = 'tetris';

/**
 * The signed-in gamer tag, or null.
 *
 * Read from the localStorage cache first because the game-over card is built
 * synchronously and cannot await a round-trip. The session is then confirmed in
 * the background and the cache cleared if it has gone stale.
 *
 * A stale tag here is cosmetic only: it changes the LABEL on the card and
 * nothing else, because submit-score re-derives identity from the JWT and reads
 * the name out of `profiles`.
 */
let signedInTag = getCachedProfile()?.gamerTag ?? null;

getSession()
  .then((session) => {
    if (!session) {
      signedInTag = null;
      clearCachedProfile();
    }
  })
  .catch((error) => {
    // Leave the cached value alone. The server is the authority on identity.
    console.error('Could not confirm session', error);
  });

function board(title) {
  const wrap = el('div', { className: 'board' });
  wrap.appendChild(el('h2', { className: 'board__title', text: title }));
  return wrap;
}

function scoreRow(rank, name, score, verified = false) {
  const li = el('li', { className: 'scorelist__row' });
  li.appendChild(el('span', { className: 'scorelist__rank', text: `${rank}.` }));
  li.appendChild(el('span', { className: 'scorelist__name', text: name }));
  if (verified) {
    // role="img" plus a label: without it a screen reader reads the tick as
    // punctuation or skips it, and the distinction it draws is the point.
    li.appendChild(el('span', {
      className: 'scorelist__badge',
      text: '✓',
      attrs: { role: 'img', 'aria-label': 'Verified account' }
    }));
  }
  li.appendChild(el('span', {
    className: 'scorelist__score',
    text: Number(score).toLocaleString()
  }));
  return li;
}

const emptyNote = (text) => el('p', { className: 'board__empty', text });

export function createScoresView(overlays) {
  function localBoard() {
    const wrap = board('Local — this browser');
    const scores = loadScores();

    if (scores.length === 0) {
      wrap.appendChild(emptyNote('No high scores yet.'));
      return wrap;
    }

    const list = el('ol', { className: 'scorelist' });
    scores.slice(0, 10).forEach((entry, i) => {
      list.appendChild(scoreRow(i + 1, entry.initials || '—', entry.score));
    });
    wrap.appendChild(list);
    return wrap;
  }

  function globalBoard() {
    const wrap = board('Global — top 10');
    const loading = emptyNote('Loading…');
    wrap.appendChild(loading);

    fetchTopScores(GAME_ID).then((scores) => {
      wrap.removeChild(loading);
      if (scores.length === 0) {
        wrap.appendChild(emptyNote('No global scores yet.'));
        return;
      }
      const list = el('ol', { className: 'scorelist' });
      scores.forEach((entry, i) => {
        list.appendChild(scoreRow(i + 1, entry.player_name, entry.score, entry.is_verified));
      });
      wrap.appendChild(list);
    }).catch((error) => {
      wrap.removeChild(loading);
      wrap.appendChild(el('p', {
        className: 'board__empty board__empty--error',
        text: 'Could not load global scores.'
      }));
      console.error('Failed to load global leaderboard', error);
    });

    return wrap;
  }

  function boardsPair() {
    const boards = el('div', { className: 'boards' });
    boards.appendChild(localBoard());
    boards.appendChild(globalBoard());
    return boards;
  }

  function showGameOver(state) {
    if (!isHighScore(state.score)) {
      showLeaderboardOnly(state);
      return;
    }

    const container = el('div');
    container.appendChild(el('p', {
      className: 'gameover__headline',
      text: `New High Score: ${state.score.toLocaleString()}!`
    }));

    // Signed in: the name is settled and the field would be a lie — the server
    // reads the tag out of `profiles` and ignores whatever the client sends.
    // Signed out: the legacy three-letter initials, unchanged.
    const input = signedInTag
      ? null
      : el('input', {
          className: 'initials__input',
          attrs: { type: 'text', maxLength: '3', id: 'initials-input', autocomplete: 'off' }
        });

    if (signedInTag) {
      const asWho = el('p', { className: 'gameover__as' });
      asWho.appendChild(el('span', { text: 'Submitting as ' }));
      asWho.appendChild(el('b', { className: 'gameover__tag', text: signedInTag }));
      container.appendChild(asWho);
    } else {
      const form = el('div', { className: 'initials' });
      form.appendChild(el('label', {
        className: 'initials__label',
        text: 'Initials',
        attrs: { for: 'initials-input' }
      }));
      form.appendChild(input);
      container.appendChild(form);
    }

    const status = el('p', { className: 'gameover__status' });
    container.appendChild(status);

    const saveBtn = el('button', { text: 'Save Score', className: 'btn', attrs: { type: 'button' } });

    async function submit() {
      // A click and an Enter can both arrive; disabled is the latch that stops
      // the same run being filed twice.
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      if (input) input.disabled = true;

      // The name sent to the server. When signed in the server overrides it
      // from the database anyway, so this only decides what the LOCAL board
      // stores — and createScoresStore clamps that to [A-Z0-9]{3}, so a gamer
      // tag shows up locally as its first three characters. The local board is
      // a per-browser record, not an identity.
      const initials = signedInTag || input.value || 'AAA';

      // Save locally
      saveScore({
        score: state.score,
        level: state.level,
        lines: state.lines,
        initials
      });

      // Submit globally if valid score > 0
      if (state.score > 0) {
        try {
          setText(status, 'Submitting to global leaderboard...');
          const sessionDurationSeconds = Math.floor((state.playTimeMs || 0) / 1000);
          await submitScore(GAME_ID, initials, state.score, sessionDurationSeconds);
        } catch (e) {
          console.error('Failed to submit global score', e);
        }
      }

      showLeaderboardOnly(state);
    }

    saveBtn.onclick = submit;

    // A dialog with a single text field should submit on Enter. There is no
    // <form> here so nothing gives that for free, and the window-level Enter
    // shortcut now deliberately ignores this field — so without this, Enter
    // would do nothing at all.
    // Only bound when the field exists; a signed-in player has no field and
    // Enter reaches the button through normal focus.
    if (input) {
      on(input, 'keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        submit();
      });
    }

    overlays.open('gameover_new_highscore', {
      title: 'Game Over',
      body: container,
      buttons: [saveBtn]
    });

    requestAnimationFrame(() => input.focus());
  }

  function showLeaderboardOnly(state) {
    const container = el('div');

    if (state) {
      container.appendChild(el('p', {
        className: 'gameover__headline',
        text: `Score ${state.score.toLocaleString()}`
      }));
      container.appendChild(el('p', {
        className: 'gameover__detail',
        text: `Level ${state.level}   Lines ${state.lines}`
      }));
    }

    container.appendChild(boardsPair());

    let buttons;
    if (state) {
      buttons = [overlays.button('Play again', 'restart')];
    } else {
      const closeBtn = el('button', { text: 'Close', className: 'btn', attrs: { type: 'button' } });
      closeBtn.onclick = () => overlays.close();
      buttons = [closeBtn];
    }

    overlays.open(state ? 'gameover' : 'leaderboard', {
      title: state ? 'Game Over' : 'High Scores',
      body: container,
      buttons
    });
  }

  return { showGameOver, showLeaderboardOnly };
}
