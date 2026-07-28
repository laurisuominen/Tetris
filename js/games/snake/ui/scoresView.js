/**
 * Game-over card: initials entry, then the two leaderboards.
 *
 * Built from classed elements only — no inline style attributes. The game page
 * ships `style-src 'self'` with no unsafe-inline, and a style attribute is
 * governed by that same directive, so inline styling here would simply be
 * dropped by the browser and the card would render unstyled.
 *
 * The two boards are labelled "Local" and "Global" in as many words, and the
 * network round-trip narrates itself: submitting, saved, or failed. A silent
 * network operation that quietly loses someone's best run is the worst version
 * of this screen.
 */

import { el, setText } from '../../../shared/util/dom.js';
import { isHighScore, saveScore, loadScores } from '../storage/scoresStore.js';
import { fetchTopScores, submitScore } from '../../../shared/net/leaderboard.js';

const GAME_ID = 'snake';

function board(title) {
  const wrap = el('div', { className: 'board' });
  wrap.appendChild(el('h2', { className: 'board__title', text: title }));
  return wrap;
}

function scoreRow(rank, name, score) {
  const li = el('li', { className: 'scorelist__row' });
  li.appendChild(el('span', { className: 'scorelist__rank', text: `${rank}.` }));
  li.appendChild(el('span', { className: 'scorelist__name', text: name }));
  li.appendChild(el('span', { className: 'scorelist__score', text: Number(score).toLocaleString() }));
  return li;
}

function emptyNote(text) {
  return el('p', { className: 'board__empty', text });
}

export function createScoresView(overlays) {
  function localBoard() {
    const wrap = board('Local — this browser');
    const scores = loadScores();

    if (scores.length === 0) {
      wrap.appendChild(emptyNote('No scores yet.'));
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
        list.appendChild(scoreRow(i + 1, entry.player_name, entry.score));
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
    if (!isHighScore(state.score) || state.score === 0) {
      showLeaderboardOnly(state);
      return;
    }

    const container = el('div');
    container.appendChild(el('p', {
      className: 'gameover__headline',
      text: `New high score: ${state.score.toLocaleString()}`
    }));

    const form = el('div', { className: 'initials' });
    const label = el('label', { className: 'initials__label', text: 'Initials', attrs: { for: 'initials-input' } });
    const input = el('input', {
      className: 'initials__input',
      attrs: { type: 'text', maxLength: '3', id: 'initials-input', autocomplete: 'off' }
    });
    form.appendChild(label);
    form.appendChild(input);
    container.appendChild(form);

    const status = el('p', { className: 'gameover__status' });
    container.appendChild(status);

    const saveBtn = el('button', { text: 'Save score', className: 'btn', attrs: { type: 'button' } });

    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      input.disabled = true;
      const initials = input.value || 'AAA';

      // Local first and unconditionally: it cannot fail and it is the copy the
      // player owns. The network is best-effort on top of that.
      saveScore({
        score: state.score,
        apples: state.apples,
        length: state.body.length,
        initials
      });

      setText(status, 'Submitting to the global leaderboard…');
      status.className = 'gameover__status';

      try {
        const seconds = Math.floor((state.playTimeMs || 0) / 1000);
        await submitScore(GAME_ID, initials, state.score, seconds);
        setText(status, 'Saved locally and globally.');
        status.className = 'gameover__status gameover__status--ok';
      } catch (error) {
        setText(status, 'Saved locally. The global leaderboard did not accept it.');
        status.className = 'gameover__status gameover__status--error';
        console.error('Failed to submit global score', error);
      }

      // Whatever happened, show the boards — with the status above still read
      // out by the live region rather than replaced by a fresh card.
      setTimeout(() => showLeaderboardOnly(state), 900);
    };

    overlays.open('gameover_new_highscore', {
      title: state.won ? 'Perfect Game' : 'Game Over',
      body: container,
      buttons: [saveBtn]
    });
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
        text: `Apples ${state.apples}   ·   Length ${state.body.length}`
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
      title: state ? (state.won ? 'Perfect Game' : 'Game Over') : 'High Scores',
      body: container,
      buttons
    });
  }

  return { showGameOver, showLeaderboardOnly };
}
