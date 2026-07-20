import { el } from '../util/dom.js';
import { isHighScore, saveScore, loadScores } from '../storage/scoresStore.js';

export function createScoresView(overlays) {
  function renderLeaderboard() {
    const scores = loadScores();
    const container = el('div', { attrs: { style: 'margin-top: 24px; text-align: left; font-size: var(--text-sm);' } });
    
    const title = el('h2', { text: 'Leaderboard', attrs: { style: 'font-size: var(--text-base); margin-bottom: 8px;' } });
    container.appendChild(title);

    if (scores.length === 0) {
      container.appendChild(el('p', { text: 'No high scores yet.', attrs: { style: 'color: var(--text-muted);' } }));
      return container;
    }
    
    const table = el('table', { attrs: { style: 'width: 100%; border-collapse: collapse;' } });
    scores.forEach((s, i) => {
      const tr = el('tr', { attrs: { style: 'border-bottom: 1px solid var(--border-subtle); line-height: 2;' } });
      const tdRank = el('td', { text: `${i + 1}.`, attrs: { style: 'color: var(--text-muted); width: 15%;' } });
      const tdInitials = el('td', { text: s.initials, attrs: { style: 'font-weight: bold; width: 25%;' } });
      const tdScore = el('td', { text: s.score.toLocaleString(), attrs: { style: 'text-align: right; font-variant-numeric: tabular-nums;' } });
      tr.appendChild(tdRank);
      tr.appendChild(tdInitials);
      tr.appendChild(tdScore);
      table.appendChild(tr);
    });
    container.appendChild(table);
    return container;
  }

  function showGameOver(state) {
    if (isHighScore(state.score)) {
      // Show input for new high score
      const container = el('div');
      container.appendChild(el('p', { text: `New High Score: ${state.score.toLocaleString()}!`, attrs: { style: 'font-weight: bold; color: var(--piece-t); margin-bottom: 16px;' } }));
      
      const inputForm = el('div', { attrs: { style: 'display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 16px;' } });
      inputForm.appendChild(el('span', { text: 'Initials:' }));
      
      const input = el('input', { attrs: { 
        type: 'text', 
        maxLength: '3', 
        style: 'width: 72px; text-align: center; text-transform: uppercase; background: var(--bg-base); color: inherit; border: 2px solid var(--border); padding: 8px; font-weight: bold; letter-spacing: 4px; border-radius: 4px;'
      }});
      inputForm.appendChild(input);
      container.appendChild(inputForm);

      const saveBtn = el('button', { text: 'Save Score', className: 'btn', attrs: { type: 'button' } });
      
      saveBtn.onclick = () => {
        saveScore({
          score: state.score,
          level: state.level,
          lines: state.lines,
          initials: input.value || 'AAA'
        });
        showLeaderboardOnly(state);
      };

      overlays.open('gameover_new_highscore', {
        title: 'Game Over',
        body: container,
        buttons: [saveBtn]
      });

      requestAnimationFrame(() => input.focus());
    } else {
      showLeaderboardOnly(state);
    }
  }

  function showLeaderboardOnly(state) {
    const container = el('div');
    container.appendChild(el('p', { text: `Score ${state.score.toLocaleString()}` }));
    container.appendChild(el('p', { text: `Level ${state.level}   Lines ${state.lines}`, attrs: { style: 'color: var(--text-muted); margin-bottom: 16px;' } }));
    container.appendChild(renderLeaderboard());

    overlays.open('gameover', {
      title: 'Game Over',
      body: container,
      buttons: [overlays.button('Play again', 'restart')]
    });
  }

  return { showGameOver };
}
