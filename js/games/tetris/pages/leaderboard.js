/**
 * Standalone high-scores page.
 *
 * Classes only, no inline style attributes: this page ships `style-src 'self'`
 * with no unsafe-inline, which governs style attributes too, so anything set
 * that way is dropped silently. The `.boards` / `.board` rules live in
 * css/pages.css.
 */

import { loadScores } from '../storage/scoresStore.js';
import { fetchTopScores } from '../../../shared/net/leaderboard.js';
import { el, qs } from '../../../shared/util/dom.js';

const GAME_ID = 'tetris';

const root = qs('#scores-root');
const boards = el('div', { className: 'boards' });
root.appendChild(boards);

function renderTable(scores, isGlobal) {
  const table = el('table', { className: 'scores' });

  const headers = isGlobal
    ? [['#', 'rank'], ['Player', ''], ['Score', 'num']]
    : [['#', 'rank'], ['Player', ''], ['Score', 'num'], ['Level', 'num'], ['Lines', 'num']];

  const head = el('tr');
  for (const [label, cls] of headers) head.appendChild(el('th', { text: label, className: cls }));
  const thead = el('thead');
  thead.appendChild(head);
  table.appendChild(thead);

  const body = el('tbody');
  scores.forEach((entry, i) => {
    const tr = el('tr');
    tr.appendChild(el('td', { text: String(i + 1), className: 'rank' }));
    tr.appendChild(el('td', {
      text: isGlobal ? entry.player_name : (entry.initials || '—'),
      className: 'initials'
    }));
    tr.appendChild(el('td', {
      text: Number(entry.score).toLocaleString(),
      className: 'num scores__score'
    }));

    if (!isGlobal) {
      tr.appendChild(el('td', { text: String(entry.level ?? '—'), className: 'num' }));
      tr.appendChild(el('td', { text: String(entry.lines ?? '—'), className: 'num' }));
    }
    body.appendChild(tr);
  });
  table.appendChild(body);

  return table;
}

function board(title) {
  const wrap = el('div', { className: 'board' });
  wrap.appendChild(el('h2', { className: 'board__title', text: title }));
  boards.appendChild(wrap);
  return wrap;
}

/* Local — always available, so it renders first and synchronously. */
const localWrap = board('Local — this browser');
const localScores = loadScores().slice().sort((a, b) => b.score - a.score).slice(0, 10);
localWrap.appendChild(
  localScores.length
    ? renderTable(localScores, false)
    : el('div', { className: 'empty', text: 'No scores yet — go play a game.' })
);

/* Global — network, so it announces its own state rather than sitting blank. */
const globalWrap = board('Global — top 10');
const loading = el('div', { className: 'empty', text: 'Loading global top 10…' });
globalWrap.appendChild(loading);

fetchTopScores(GAME_ID).then((scores) => {
  globalWrap.removeChild(loading);
  globalWrap.appendChild(
    scores.length
      ? renderTable(scores, true)
      : el('div', { className: 'empty', text: 'No global scores yet.' })
  );
}).catch((error) => {
  globalWrap.removeChild(loading);
  globalWrap.appendChild(el('div', {
    className: 'empty',
    text: 'Failed to load global scores.'
  }));
  console.error(error);
});
