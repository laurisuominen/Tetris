/**
 * Scoring, level progression and back-to-back — spec §8 and §9.
 */

export const TSPIN_NONE = 'none';
export const TSPIN_MINI = 'mini';
export const TSPIN_FULL = 'full';

/** Base points per line count, before the level multiplier — spec §8. */
const LINE_POINTS = [0, 100, 300, 500, 800];

/** T-spin bonuses — spec §8. Index by line count. */
const TSPIN_POINTS = [400, 800, 1200, 1600];
const TSPIN_MINI_POINTS = [100, 100, 200, 200];

/**
 * Level from total lines cleared — spec §9.
 *
 * v1 divided by 5 here (index.html:740), levelling twice as fast as specified.
 * The test suite pins levelFor(50) === 6 to keep that from returning.
 */
export function levelFor(totalLines) {
  return Math.floor(totalLines / 10) + 1;
}

/**
 * Whether a clear is "difficult" and so extends a back-to-back chain.
 * Tetrises and all T-spins qualify; ordinary singles through triples do not.
 */
export function isDifficult({ lines, tSpin }) {
  if (tSpin !== TSPIN_NONE) return true;
  return lines === 4;
}

function baseLabel(lines, tSpin) {
  if (tSpin === TSPIN_FULL) {
    return ['T-Spin', 'T-Spin Single', 'T-Spin Double', 'T-Spin Triple'][lines];
  }
  if (tSpin === TSPIN_MINI) {
    return lines === 0 ? 'T-Spin Mini' : `T-Spin Mini ${['', 'Single', 'Double'][lines]}`;
  }
  return ['', 'Single', 'Double', 'Triple', 'Tetris'][lines];
}

/**
 * Points for a lock that cleared `lines` rows.
 *
 * Returns the new back-to-back flag alongside the score so the caller never has
 * to reimplement the chain rules. A lock that clears nothing leaves an existing
 * chain intact — only a non-difficult *clear* breaks it.
 */
export function scoreClear({ lines, tSpin = TSPIN_NONE, level, backToBack = false }) {
  if (lines === 0 && tSpin === TSPIN_NONE) {
    return { points: 0, backToBack, label: '' };
  }

  let base;
  if (tSpin === TSPIN_FULL) base = TSPIN_POINTS[lines];
  else if (tSpin === TSPIN_MINI) base = TSPIN_MINI_POINTS[lines];
  else base = LINE_POINTS[lines];

  const difficult = isDifficult({ lines, tSpin });
  const chained = difficult && backToBack && lines > 0;
  const points = Math.floor(base * level * (chained ? 1.5 : 1));

  // A difficult clear starts or continues the chain; a non-difficult one breaks
  // it. A T-spin with no lines is difficult but does not itself score a chain.
  const nextBackToBack = lines === 0 ? backToBack : difficult;

  const label = baseLabel(lines, tSpin);
  return {
    points,
    backToBack: nextBackToBack,
    label: chained ? `Back-to-Back ${label}` : label
  };
}

/** Soft drop scores 1 per cell — spec §8. */
export const softDropPoints = (cells) => cells;

/** Hard drop scores 2 per cell — spec §8. */
export const hardDropPoints = (cells) => cells * 2;
