/**
 * Breakout local high scores.
 *
 * A key of its own. createScoresStore demands one rather than defaulting,
 * precisely so two games cannot silently share a list — which is exactly what
 * would happen here otherwise.
 */

import { createScoresStore } from '../../../shared/storage/scoresStore.js';

const store = createScoresStore('breakout_scores_v1');

export const { loadScores, saveScore, isHighScore } = store;
