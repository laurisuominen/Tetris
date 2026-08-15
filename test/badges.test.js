/**
 * The achievement catalogue and the rule that awards from it.
 *
 * badges.js has zero imports for the same reason gamerTag.js does — Deno, Node
 * and the browser all load that exact file with no build step, so these tests
 * cover the code that actually runs rather than a copy of it.
 *
 * Thresholds are imported rather than retyped. A test that hard-codes 50,000
 * passes forever once someone changes the catalogue to 60,000 and forgets this
 * file; importing them means the boundary cases stay boundary cases.
 */

import { describe, it, expect } from './harness.js';
import {
  BADGES,
  badgeFor,
  bestTier,
  evaluate,
  BRONZE,
  SILVER,
  GOLD,
  SCORE_TIERS,
  PLAYS_TIERS,
  DAYS_TIERS,
  TOP_TEN,
  LEET_SCORE
} from '../supabase/functions/_shared/badges.js';

const ALL_GAMES = Object.keys(SCORE_TIERS);

/** A player who has done the bare minimum, so each test adds only its own fact. */
function stats(overrides = {}) {
  return { plays: 1, games: ['snake'], bestScore: 0, days: 1, ...overrides };
}

function run(overrides = {}) {
  return { gameId: 'snake', score: 0, rank: null, ...overrides };
}

function has(keys, key) {
  return keys.includes(key);
}

describe('badge catalogue', () => {
  it('has no duplicate keys', () => {
    const keys = BADGES.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every badge a key, a title and a tier', () => {
    const bad = BADGES.filter(
      (b) =>
        typeof b.key !== 'string' || b.key === '' ||
        typeof b.title !== 'string' || b.title === '' ||
        ![BRONZE, SILVER, GOLD].includes(b.tier)
    );
    expect(bad.map((b) => b.key)).toEqual([]);
  });

  it('describes hidden badges too — hidden means "not shown yet", not "never written"', () => {
    const hidden = BADGES.filter((b) => b.hidden);
    expect(hidden.length).toBeGreaterThan(0);
    const undescribed = hidden.filter(
      (b) => typeof b.description !== 'string' || b.description === ''
    );
    expect(undescribed.map((b) => b.key)).toEqual([]);
  });

  it('uses hidden sparingly — one badge, per the research', () => {
    expect(BADGES.filter((b) => b.hidden).length).toBe(1);
  });

  it('carries a three-rung score ladder for every game', () => {
    for (const gameId of ALL_GAMES) {
      const ladder = BADGES.filter((b) => b.game === gameId);
      expect(ladder.length).toBe(3);
      expect(ladder.map((b) => b.tier)).toEqual([BRONZE, SILVER, GOLD]);
    }
  });

  it('keeps each ladder strictly increasing', () => {
    for (const gameId of ALL_GAMES) {
      const [bronze, silver, gold] = SCORE_TIERS[gameId];
      expect(bronze).toBeLessThan(silver);
      expect(silver).toBeLessThan(gold);
    }
  });

  it('names the arcade-wide badges with no game', () => {
    const arcadeWide = BADGES.filter((b) => b.game === null);
    expect(arcadeWide.length).toBe(BADGES.length - ALL_GAMES.length * 3);
  });

  it('resolves a known key and returns null for an unknown one', () => {
    expect(badgeFor('first-score').title).toBe('On the Board');
    // A browser holding a cached catalogue can be handed a key from a newer
    // deploy. That must render as nothing, not throw.
    expect(badgeFor('not-a-badge')).toBeNull();
    expect(badgeFor(undefined)).toBeNull();
  });
});

describe('bestTier', () => {
  it('picks gold over silver over bronze', () => {
    expect(bestTier(['first-score', 'plays-50', 'plays-200'])).toBe(GOLD);
    expect(bestTier(['first-score', 'plays-50'])).toBe(SILVER);
    expect(bestTier(['first-score'])).toBe(BRONZE);
  });

  it('is null for nothing earned, and for keys it does not know', () => {
    expect(bestTier([])).toBeNull();
    expect(bestTier(['not-a-badge'])).toBeNull();
    expect(bestTier(null)).toBeNull();
  });
});

describe('evaluate — milestones', () => {
  it('awards On the Board on the very first submission', () => {
    expect(has(evaluate(stats({ plays: 1 }), run()), 'first-score')).toBeTruthy();
  });

  it('awards nothing to a player with no plays counted', () => {
    expect(evaluate(stats({ plays: 0, days: 0 }), run())).toEqual([]);
  });

  it('tolerates junk in place of stats rather than throwing', () => {
    expect(evaluate(null, null)).toEqual([]);
    expect(evaluate({}, {})).toEqual([]);
  });
});

describe('evaluate — Arcade Tourist', () => {
  it('needs every game in the catalogue', () => {
    const partial = evaluate(stats({ games: ALL_GAMES.slice(0, -1) }), run());
    expect(has(partial, 'all-three')).toBeFalsy();

    const complete = evaluate(stats({ games: ALL_GAMES }), run());
    expect(has(complete, 'all-three')).toBeTruthy();
  });

  it('is not fooled by a repeated game', () => {
    const keys = evaluate(stats({ games: ['snake', 'snake', 'snake'] }), run());
    expect(has(keys, 'all-three')).toBeFalsy();
  });
});

describe('evaluate — plays and days at the boundary', () => {
  for (const threshold of PLAYS_TIERS) {
    it(`awards plays-${threshold} at exactly ${threshold} and not one below`, () => {
      expect(has(evaluate(stats({ plays: threshold - 1 }), run()), `plays-${threshold}`))
        .toBeFalsy();
      expect(has(evaluate(stats({ plays: threshold }), run()), `plays-${threshold}`))
        .toBeTruthy();
    });
  }

  for (const threshold of DAYS_TIERS) {
    it(`awards days-${threshold} at exactly ${threshold} and not one below`, () => {
      expect(has(evaluate(stats({ days: threshold - 1 }), run()), `days-${threshold}`))
        .toBeFalsy();
      expect(has(evaluate(stats({ days: threshold }), run()), `days-${threshold}`))
        .toBeTruthy();
    });
  }

  it('keeps the lower rungs when a higher one is reached', () => {
    const keys = evaluate(stats({ plays: PLAYS_TIERS[2] }), run());
    for (const threshold of PLAYS_TIERS) {
      expect(has(keys, `plays-${threshold}`)).toBeTruthy();
    }
  });
});

describe('evaluate — score ladders', () => {
  for (const gameId of ALL_GAMES) {
    SCORE_TIERS[gameId].forEach((threshold, index) => {
      const key = `score-${gameId}-${index + 1}`;
      it(`awards ${key} at exactly ${threshold} and not one below`, () => {
        const below = evaluate(stats({ bestScore: threshold - 1 }), run({ gameId }));
        expect(has(below, key)).toBeFalsy();

        const at = evaluate(stats({ bestScore: threshold }), run({ gameId }));
        expect(has(at, key)).toBeTruthy();
      });
    });
  }

  it('reads the lifetime best, not this run — a bad night does not un-earn a badge', () => {
    const keys = evaluate(
      stats({ bestScore: SCORE_TIERS.snake[2] }),
      run({ gameId: 'snake', score: 1 })
    );
    expect(has(keys, 'score-snake-3')).toBeTruthy();
  });

  it('awards a ladder only to its own game', () => {
    const keys = evaluate(
      stats({ bestScore: SCORE_TIERS.tetris[2] }),
      run({ gameId: 'tetris' })
    );
    expect(has(keys, 'score-tetris-3')).toBeTruthy();
    expect(has(keys, 'score-snake-3')).toBeFalsy();
  });

  it('awards no ladder for a game it does not know', () => {
    const keys = evaluate(stats({ bestScore: 10_000_000 }), run({ gameId: 'pong' }));
    expect(keys.filter((k) => k.startsWith('score-'))).toEqual([]);
  });
});

describe('evaluate — rank', () => {
  it(`awards Top Ten at raw rank ${TOP_TEN} and not at ${TOP_TEN + 1}`, () => {
    expect(has(evaluate(stats(), run({ rank: TOP_TEN + 1 })), 'top-ten')).toBeFalsy();
    expect(has(evaluate(stats(), run({ rank: TOP_TEN })), 'top-ten')).toBeTruthy();
  });

  it('awards High Score Holder only at rank one, with Top Ten alongside', () => {
    const first = evaluate(stats(), run({ rank: 1 }));
    expect(has(first, 'rank-one')).toBeTruthy();
    expect(has(first, 'top-ten')).toBeTruthy();

    const second = evaluate(stats(), run({ rank: 2 }));
    expect(has(second, 'rank-one')).toBeFalsy();
  });

  it('treats an unknown rank as not qualifying, never as first', () => {
    // The Edge Function skips the rank query when both badges are already held,
    // and a failed count must not hand out the rarest badge in the catalogue.
    for (const rank of [null, undefined, 0, -1, 1.5, '1']) {
      const keys = evaluate(stats(), run({ rank }));
      expect(has(keys, 'rank-one')).toBeFalsy();
      expect(has(keys, 'top-ten')).toBeFalsy();
    }
  });
});

describe('evaluate — the hidden one', () => {
  it(`needs exactly ${LEET_SCORE}`, () => {
    expect(has(evaluate(stats(), run({ score: LEET_SCORE })), 'leet')).toBeTruthy();
    expect(has(evaluate(stats(), run({ score: LEET_SCORE - 1 })), 'leet')).toBeFalsy();
    expect(has(evaluate(stats(), run({ score: LEET_SCORE + 1 })), 'leet')).toBeFalsy();
  });
});

describe('evaluate — shape of the answer', () => {
  it('is idempotent: the same input twice gives the same keys', () => {
    const s = stats({ plays: 50, days: 7, games: ALL_GAMES, bestScore: 999_999 });
    const r = run({ gameId: 'tetris', score: LEET_SCORE, rank: 1 });
    expect(evaluate(s, r)).toEqual(evaluate(s, r));
  });

  it('returns keys in catalogue order, so two callers can compare without sorting', () => {
    const keys = evaluate(
      stats({ plays: PLAYS_TIERS[0], days: DAYS_TIERS[0], games: ALL_GAMES }),
      run({ rank: 1 })
    );
    const order = BADGES.map((b) => b.key);
    const positions = keys.map((k) => order.indexOf(k));
    const sorted = positions.slice().sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it('returns only keys the catalogue defines', () => {
    const keys = evaluate(
      stats({ plays: 1000, days: 1000, games: ALL_GAMES, bestScore: 10_000_000 }),
      run({ gameId: 'tetris', score: LEET_SCORE, rank: 1 })
    );
    expect(keys.filter((k) => badgeFor(k) === null)).toEqual([]);
  });

  it('can award every badge at once — nothing is unreachable', () => {
    // Run once per game so each ladder gets its chance; the union must be the
    // whole catalogue. A badge no input can produce is a badge that is broken.
    const awarded = new Set();
    for (const gameId of ALL_GAMES) {
      evaluate(
        {
          plays: PLAYS_TIERS[PLAYS_TIERS.length - 1],
          days: DAYS_TIERS[DAYS_TIERS.length - 1],
          games: ALL_GAMES,
          bestScore: SCORE_TIERS[gameId][2]
        },
        { gameId, score: LEET_SCORE, rank: 1 }
      ).forEach((k) => awarded.add(k));
    }
    expect(awarded.size).toBe(BADGES.length);
  });
});
