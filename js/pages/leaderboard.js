/**
 * Standalone leaderboard page.
 *
 * Reads the same validated localStorage scores the game writes (same origin,
 * so storage is shared) and renders them. All text goes through el()'s
 * textContent, so stored initials can never inject markup.
 */

import { loadScores } from '../storage/scoresStore.js';
import { el } from '../util/dom.js';

const root = document.getElementById('scores-root');
const scores = loadScores().slice().sort((a, b) => b.score - a.score).slice(0, 10);

if (scores.length === 0) {
  root.appendChild(el('div', {
    className: 'empty',
    text: 'No scores yet — go play a game.'
  }));
} else {
  const table = el('table', { className: 'scores' });

  const head = el('tr');
  for (const [label, cls] of [['#', 'rank'], ['Player', ''], ['Score', 'num'],
                              ['Level', 'num'], ['Lines', 'num']]) {
    head.appendChild(el('th', { text: label, className: cls }));
  }
  const thead = el('thead');
  thead.appendChild(head);
  table.appendChild(thead);

  const body = el('tbody');
  scores.forEach((s, i) => {
    const tr = el('tr');
    tr.appendChild(el('td', { text: String(i + 1), className: 'rank' }));
    tr.appendChild(el('td', { text: s.initials || '—', className: 'initials' }));
    tr.appendChild(el('td', { text: Number(s.score).toLocaleString(), className: 'num scores__score' }));
    tr.appendChild(el('td', { text: String(s.level ?? '—'), className: 'num' }));
    tr.appendChild(el('td', { text: String(s.lines ?? '—'), className: 'num' }));
    body.appendChild(tr);
  });
  table.appendChild(body);

  root.appendChild(table);
}
