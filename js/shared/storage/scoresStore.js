/**
 * Local high-score table, kept per game.
 *
 * The storage key is a constructor argument so each game owns its own table —
 * the existing Tetris key is preserved verbatim by its caller, so nobody loses
 * a saved score.
 */

import { getItem, setItem } from './storage.js';

const MAX_ENTRIES = 10;

export function createScoresStore(key) {
  if (!key) throw new Error('createScoresStore requires a storage key');

  function loadScores() {
    const scores = getItem(key, []);
    if (!Array.isArray(scores)) return [];
    // Validate elements
    return scores.filter(s =>
      s && typeof s === 'object' &&
      typeof s.score === 'number' &&
      typeof s.initials === 'string'
    );
  }

  function saveScore(scoreEntry) {
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
    const top = scores.slice(0, MAX_ENTRIES);
    setItem(key, top);
    return top;
  }

  function isHighScore(score) {
    if (score === 0) return false;
    const scores = loadScores();
    if (scores.length < MAX_ENTRIES) return true;
    return score > scores[scores.length - 1].score;
  }

  return { loadScores, saveScore, isHighScore };
}
