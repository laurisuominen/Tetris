import { getItem, setItem } from './storage.js';

const KEY = 'tetris_scores_v1';

export function loadScores() {
  const scores = getItem(KEY, []);
  if (!Array.isArray(scores)) return [];
  // Validate elements
  return scores.filter(s => 
    s && typeof s === 'object' &&
    typeof s.score === 'number' &&
    typeof s.initials === 'string'
  );
}

export function saveScore(scoreEntry) {
  const scores = loadScores();
  
  // Sanitize initials to exactly 3 letters/numbers
  const initials = (scoreEntry.initials || 'AAA')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3)
    .padEnd(3, 'A');

  scores.push({
    ...scoreEntry,
    initials,
    date: scoreEntry.date || new Date().toISOString()
  });

  scores.sort((a, b) => b.score - a.score);
  const top10 = scores.slice(0, 10);
  setItem(KEY, top10);
  return top10;
}

export function isHighScore(score) {
  if (score === 0) return false;
  const scores = loadScores();
  if (scores.length < 10) return true;
  return score > scores[scores.length - 1].score;
}
