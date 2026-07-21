/**
 * Score, level, lines and the clear-label badge.
 *
 * The score counts up rather than snapping, which makes a big clear feel like
 * it landed. Purely cosmetic: it runs on wall time and reads state, never
 * writes it.
 */

import { qs, setText, setHidden } from '../util/dom.js';

const COUNT_UP_MS = 260;

export function createHud() {
  const scoreEl = qs('#stat-score');
  const levelEl = qs('#stat-level');
  const linesEl = qs('#stat-lines');
  const badgeEl = qs('#badge');

  let displayedScore = 0;
  let animation = null;
  let badgeTimer = null;

  const reducedMotion = () =>
    document.documentElement.dataset.motion === 'off'
    || matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animateScore(to) {
    if (animation) cancelAnimationFrame(animation);

    if (reducedMotion() || to - displayedScore < 2) {
      displayedScore = to;
      setText(scoreEl, to.toLocaleString());
      return;
    }

    const from = displayedScore;
    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min((now - start) / COUNT_UP_MS, 1);
      // Ease-out so the number decelerates into its final value.
      const eased = 1 - (1 - progress) ** 3;
      displayedScore = Math.round(from + (to - from) * eased);
      setText(scoreEl, displayedScore.toLocaleString());
      if (progress < 1) animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
  }

  return {
    update(state) {
      if (state.score !== displayedScore) animateScore(state.score);
      setText(levelEl, state.level);
      setText(linesEl, state.lines);
    },

    flashLevel() {
      levelEl.dataset.flash = 'true';
      setTimeout(() => delete levelEl.dataset.flash, 400);
    },

    /** Shows "Tetris", "T-Spin Double", "Back-to-Back Tetris" and so on. */
    showBadge(label) {
      if (!label) return;
      clearTimeout(badgeTimer);
      setText(badgeEl, label);
      setHidden(badgeEl, false);
      badgeTimer = setTimeout(() => setHidden(badgeEl, true), 1600);
    },

    reset() {
      displayedScore = 0;
      setText(scoreEl, '0');
      setText(levelEl, '1');
      setText(linesEl, '0');
      setHidden(badgeEl, true);
    }
  };
}
