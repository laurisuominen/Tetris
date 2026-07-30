/**
 * Score, level, lives and the badge.
 *
 * The score counts up rather than snapping. Purely cosmetic: it runs on wall
 * time and reads state, never writes it.
 *
 * Lives are pips rather than a number. Three of something is faster to count
 * than a digit is to read, and lives are the one stat a player checks with the
 * ball already in the air.
 */

import { qs, setText, setHidden, el } from '../../../shared/util/dom.js';
import { START_LIVES } from '../core/constants.js';

const COUNT_UP_MS = 220;

export function createHud() {
  const scoreEl = qs('#stat-score');
  const levelEl = qs('#stat-level');
  const livesEl = qs('#stat-lives');
  const badgeEl = qs('#badge');

  let displayedScore = 0;
  let displayedLives = -1;
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

  /**
   * Redraws the pips only when the count changes.
   *
   * update() runs every frame; rebuilding four elements sixty times a second
   * to say the same thing is the sort of thing that quietly costs a frame.
   */
  function renderLives(lives) {
    if (lives === displayedLives) return;
    displayedLives = lives;

    livesEl.replaceChildren();
    for (let i = 0; i < START_LIVES; i++) {
      livesEl.appendChild(el('span', {
        className: i < lives ? 'lives__pip' : 'lives__pip lives__pip--spent'
      }));
    }
    // The pips are decorative to a screen reader; the label is the real value.
    livesEl.setAttribute('aria-label', `${lives} ${lives === 1 ? 'life' : 'lives'} left`);
  }

  return {
    update(state) {
      if (state.score !== displayedScore) animateScore(state.score);
      setText(levelEl, state.level);
      renderLives(state.lives);
    },

    /** Brief label — a milestone, a level, or the win. */
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
      setText(levelEl, '1');
      displayedLives = -1;
      renderLives(START_LIVES);
      setHidden(badgeEl, true);
    }
  };
}
