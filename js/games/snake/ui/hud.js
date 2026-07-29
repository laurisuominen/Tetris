/**
 * Score, length, apples and the badge.
 *
 * The score counts up rather than snapping. Purely cosmetic: it runs on wall
 * time and reads state, never writes it.
 */

import { qs, setText, setHidden } from '../../../shared/util/dom.js';
import { START_LENGTH } from '../core/constants.js';

const COUNT_UP_MS = 220;

export function createHud() {
  const scoreEl = qs('#stat-score');
  const lengthEl = qs('#stat-length');
  const applesEl = qs('#stat-apples');
  const badgeEl = qs('#badge');

  let displayedScore = 0;
  let animation = null;
  let badgeTimer = null;

  const reducedMotion = () =>
    document.documentElement.dataset.motion === 'off'
    || matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animateScore(to) {
    if (animation) cancelAnimationFrame(animation);

    if (reducedMotion() || Math.abs(to - displayedScore) < 2) {
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
      setText(lengthEl, state.body.length);
      setText(applesEl, state.apples);
    },

    /** Brief label — a milestone, or the win. */
    showBadge(label) {
      if (!label) return;
      clearTimeout(badgeTimer);
      setText(badgeEl, label);
      setHidden(badgeEl, false);
      badgeTimer = setTimeout(() => setHidden(badgeEl, true), 1600);
    },

    reset() {
      if (animation) cancelAnimationFrame(animation);
      displayedScore = 0;
      setText(scoreEl, '0');
      setText(lengthEl, String(START_LENGTH));
      setText(applesEl, '0');
      setHidden(badgeEl, true);
    }
  };
}
