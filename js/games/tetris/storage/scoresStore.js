/**
 * Tetris local high scores.
 *
 * The key is unchanged from before the arcade restructure, so existing saved
 * scores keep loading.
 */

import { createScoresStore } from '../../../shared/storage/scoresStore.js';

const store = createScoresStore('tetris_scores_v1');

export const { loadScores, saveScore, isHighScore } = store;
