/**
 * Chomp local high scores. A key of its own — createScoresStore demands one
 * rather than defaulting, precisely so two games cannot share a list.
 */

import { createScoresStore } from '../../../shared/storage/scoresStore.js';

const store = createScoresStore('chomp_scores_v1');

export const { loadScores, saveScore, isHighScore } = store;
