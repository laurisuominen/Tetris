import { el } from '../util/dom.js';
import { isHighScore, saveScore, loadScores } from '../storage/scoresStore.js';
import { fetchTopScores, submitScore } from '../leaderboard.js';

export function createScoresView(overlays) {
  function renderLocalLeaderboard() {
    const scores = loadScores();
    const container = el('div', { attrs: { style: 'margin-top: 16px; text-align: left; font-size: var(--text-sm); flex: 1;' } });
    
    const title = el('h2', { text: 'Local High Scores', attrs: { style: 'font-size: var(--text-base); margin-bottom: 8px;' } });
    container.appendChild(title);

    if (scores.length === 0) {
      container.appendChild(el('p', { text: 'No high scores yet.', attrs: { style: 'color: var(--text-muted);' } }));
      return container;
    }
    
    const table = el('table', { attrs: { style: 'width: 100%; border-collapse: collapse;' } });
    scores.slice(0, 10).forEach((s, i) => {
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

  function renderGlobalLeaderboardContainer() {
    const container = el('div', { attrs: { style: 'margin-top: 16px; text-align: left; font-size: var(--text-sm); flex: 1;' } });
    const title = el('h2', { text: 'Global Top 10', attrs: { style: 'font-size: var(--text-base); margin-bottom: 8px;' } });
    container.appendChild(title);

    const loadingText = el('p', { text: 'Loading...', attrs: { style: 'color: var(--text-muted);' } });
    container.appendChild(loadingText);

    fetchTopScores().then(scores => {
      container.removeChild(loadingText);
      if (scores.length === 0) {
        container.appendChild(el('p', { text: 'No global scores yet.', attrs: { style: 'color: var(--text-muted);' } }));
        return;
      }

      const table = el('table', { attrs: { style: 'width: 100%; border-collapse: collapse;' } });
      scores.forEach((s, i) => {
        const tr = el('tr', { attrs: { style: 'border-bottom: 1px solid var(--border-subtle); line-height: 2;' } });
        const tdRank = el('td', { text: `${i + 1}.`, attrs: { style: 'color: var(--text-muted); width: 15%;' } });
        const tdInitials = el('td', { text: s.player_name, attrs: { style: 'font-weight: bold; width: 25%;' } });
        const tdScore = el('td', { text: s.score.toLocaleString(), attrs: { style: 'text-align: right; font-variant-numeric: tabular-nums;' } });
        tr.appendChild(tdRank);
        tr.appendChild(tdInitials);
        tr.appendChild(tdScore);
        table.appendChild(tr);
      });
      container.appendChild(table);
    }).catch(err => {
      container.removeChild(loadingText);
      container.appendChild(el('p', { text: 'Error loading scores.', attrs: { style: 'color: var(--piece-z);' } }));
    });

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
      const statusMsg = el('p', { text: '', attrs: { style: 'font-size: var(--text-xs); margin-top: 8px;' } });
      container.appendChild(statusMsg);
      
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        input.disabled = true;
        const initials = input.value || 'AAA';
        
        // Save locally
        saveScore({
          score: state.score,
          level: state.level,
          lines: state.lines,
          initials: initials
        });

        // Submit globally if valid score > 0
        if (state.score > 0) {
          try {
            statusMsg.textContent = 'Submitting to global leaderboard...';
            statusMsg.style.color = 'var(--text-muted)';
            const sessionDurationSeconds = Math.floor((state.playTimeMs || 0) / 1000);
            await submitScore(initials, state.score, sessionDurationSeconds);
          } catch (e) {
            console.error('Failed to submit global score', e);
          }
        }
        
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
    if (state) {
      container.appendChild(el('p', { text: `Score ${state.score.toLocaleString()}` }));
      container.appendChild(el('p', { text: `Level ${state.level}   Lines ${state.lines}`, attrs: { style: 'color: var(--text-muted); margin-bottom: 16px;' } }));
    }
    
    const boardsContainer = el('div', { attrs: { style: 'display: flex; gap: 24px; justify-content: center; flex-wrap: wrap;' } });
    boardsContainer.appendChild(renderLocalLeaderboard());
    boardsContainer.appendChild(renderGlobalLeaderboardContainer());
    
    container.appendChild(boardsContainer);

    let buttons;
    if (state) {
      buttons = [overlays.button('Play again', 'restart')];
    } else {
      const closeBtn = el('button', { text: 'Close', className: 'btn', attrs: { type: 'button' } });
      closeBtn.onclick = () => overlays.close();
      buttons = [closeBtn];
    }

    // Use a wider modal to fit two leaderboards side-by-side on desktop
    const modalKind = state ? 'gameover' : 'leaderboard';
    overlays.open(modalKind, {
      title: state ? 'Game Over' : 'High Scores',
      body: container,
      buttons
    });
  }

  return { showGameOver, showLeaderboardOnly };
}
