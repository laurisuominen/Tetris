import { loadScores } from '../storage/scoresStore.js';
import { fetchTopScores } from '../leaderboard.js';
import { el } from '../util/dom.js';

const root = document.getElementById('scores-root');
root.style.display = 'flex';
root.style.flexWrap = 'wrap';
root.style.gap = '24px';
root.style.justifyContent = 'center';

function renderTable(titleText, scores, isGlobal = false) {
  const container = el('div', { attrs: { style: 'flex: 1; min-width: 300px;' } });
  
  const title = el('h2', { text: titleText, attrs: { style: 'font-size: var(--text-base); margin-bottom: 16px; text-align: center;' } });
  container.appendChild(title);

  if (scores.length === 0) {
    container.appendChild(el('div', {
      className: 'empty',
      text: isGlobal ? 'No global scores yet.' : 'No scores yet — go play a game.',
      attrs: { style: 'text-align: center; color: var(--text-muted);' }
    }));
    return container;
  }
  
  const table = el('table', { className: 'scores', attrs: { style: 'width: 100%;' } });

  const head = el('tr');
  const headers = isGlobal 
    ? [['#', 'rank'], ['Player', ''], ['Score', 'num']]
    : [['#', 'rank'], ['Player', ''], ['Score', 'num'], ['Level', 'num'], ['Lines', 'num']];

  for (const [label, cls] of headers) {
    head.appendChild(el('th', { text: label, className: cls }));
  }
  
  const thead = el('thead');
  thead.appendChild(head);
  table.appendChild(thead);

  const body = el('tbody');
  scores.forEach((s, i) => {
    const tr = el('tr');
    tr.appendChild(el('td', { text: String(i + 1), className: 'rank' }));
    tr.appendChild(el('td', { text: isGlobal ? s.player_name : (s.initials || '—'), className: 'initials' }));
    tr.appendChild(el('td', { text: Number(s.score).toLocaleString(), className: 'num scores__score' }));
    
    if (!isGlobal) {
      tr.appendChild(el('td', { text: String(s.level ?? '—'), className: 'num' }));
      tr.appendChild(el('td', { text: String(s.lines ?? '—'), className: 'num' }));
    }
    body.appendChild(tr);
  });
  table.appendChild(body);

  container.appendChild(table);
  return container;
}

// 1. Render Local Scores
const localScores = loadScores().slice().sort((a, b) => b.score - a.score).slice(0, 10);
root.appendChild(renderTable('Local High Scores', localScores, false));

// 2. Render Global Scores Placeholder
const globalContainerWrapper = el('div', { attrs: { style: 'flex: 1; min-width: 300px;' } });
root.appendChild(globalContainerWrapper);

const loadingMsg = el('p', { text: 'Loading global top 10...', attrs: { style: 'text-align: center; color: var(--text-muted); padding-top: 48px;' } });
globalContainerWrapper.appendChild(loadingMsg);

fetchTopScores().then(globalScores => {
  globalContainerWrapper.removeChild(loadingMsg);
  globalContainerWrapper.appendChild(renderTable('Global Top 10', globalScores, true));
}).catch(err => {
  globalContainerWrapper.removeChild(loadingMsg);
  globalContainerWrapper.appendChild(el('p', { text: 'Failed to load global scores.', attrs: { style: 'text-align: center; color: var(--piece-z); padding-top: 48px;' } }));
  console.error(err);
});
