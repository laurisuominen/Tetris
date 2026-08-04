/**
 * The global board's per-player cap.
 *
 * topScores.js has no imports precisely so this file can exist — leaderboard.js
 * itself pulls in client.js, which reads window.supabase at module evaluation
 * and throws under Node.
 */

import { describe, it, expect } from './harness.js';
import {
  capPerPlayer,
  MAX_PER_PLAYER,
  BOARD_SIZE,
  FETCH_LIMIT
} from '../js/shared/net/topScores.js';

/* Rows as the query returns them: already sorted best-first. */
function row(player_name, score, extra = {}) {
  return { player_name, score, is_verified: false, ...extra };
}

function names(rows) {
  return rows.map((r) => r.player_name);
}

describe('topScores constants', () => {
  it('caps a name at three rows', () => {
    expect(MAX_PER_PLAYER).toBe(3);
  });

  it('still shows a board of ten', () => {
    expect(BOARD_SIZE).toBe(10);
  });

  it('fetches the whole retained table so the filtered board is exact', () => {
    // Must match prune_leaderboard(100) in
    // migrations/20260730000000_prune_leaderboard_per_game.sql.
    expect(FETCH_LIMIT).toBe(100);
  });
});

describe('capPerPlayer', () => {
  it('is the bug: one player no longer holds the whole board', () => {
    // Exactly the shape the user reported — a dominant player above everyone.
    const rows = [
      row('SALT', 900), row('SALT', 880), row('SALT', 870), row('SALT', 860),
      row('SALT', 850), row('SALT', 840), row('SALT', 830), row('SALT', 820),
      row('SALT', 810), row('SALT', 800),
      row('CJG', 700), row('LHS', 600), row('ABC', 500)
    ];
    expect(names(capPerPlayer(rows, 3, 10)))
      .toEqual(['SALT', 'SALT', 'SALT', 'CJG', 'LHS', 'ABC']);
  });

  it('keeps a player\'s BEST rows, not their first three by any other order', () => {
    const rows = [row('SALT', 900), row('SALT', 880), row('SALT', 870), row('SALT', 10)];
    expect(capPerPlayer(rows, 3, 10).map((r) => r.score)).toEqual([900, 880, 870]);
  });

  it('leaves an already-fair board untouched', () => {
    const rows = [row('AAA', 5), row('BBB', 4), row('CCC', 3)];
    expect(capPerPlayer(rows, 3, 10)).toEqual(rows);
  });

  it('preserves the incoming order', () => {
    const rows = [row('AAA', 9), row('BBB', 8), row('AAA', 7), row('CCC', 6)];
    expect(capPerPlayer(rows, 3, 10).map((r) => r.score)).toEqual([9, 8, 7, 6]);
  });

  it('returns fewer than the limit when the cap leaves nothing else', () => {
    const rows = [row('SALT', 9), row('SALT', 8), row('SALT', 7), row('SALT', 6)];
    expect(capPerPlayer(rows, 3, 10).length).toBe(3);
  });

  it('never returns more than the limit', () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(`P${i}`, 100 - i));
    expect(capPerPlayer(rows, 3, 10).length).toBe(10);
  });

  it('stops at the limit even when later rows would still qualify', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(`P${i}`, 100 - i));
    expect(names(capPerPlayer(rows, 3, 3))).toEqual(['P0', 'P1', 'P2']);
  });

  it('groups case-insensitively, so a tag cannot be re-cased for more slots', () => {
    // gamer_tag_key is uniquely indexed case-folded, so SALT and salt cannot be
    // two accounts; treating them as two players would be a free extra slot.
    const rows = [row('SALT', 9), row('salt', 8), row('SaLt', 7), row('Salt', 6), row('CJG', 5)];
    expect(names(capPerPlayer(rows, 3, 10))).toEqual(['SALT', 'salt', 'SaLt', 'CJG']);
  });

  it('groups across surrounding whitespace', () => {
    const rows = [row('SALT', 9), row(' SALT ', 8), row('SALT', 7), row('SALT', 6)];
    expect(capPerPlayer(rows, 3, 10).length).toBe(3);
  });

  it('makes a verified row and a look-alike anonymous one share the quota', () => {
    // The decision documented in topScores.js: splitting the quota would put
    // SALT on the board six times, which reads as broken.
    const rows = [
      row('SALT', 9, { is_verified: true }),
      row('SALT', 8, { is_verified: true }),
      row('SALT', 7),
      row('SALT', 6, { is_verified: true }),
      row('CJG', 5)
    ];
    expect(capPerPlayer(rows, 3, 10).map((r) => r.score)).toEqual([9, 8, 7, 5]);
  });

  it('treats a missing name as one group rather than throwing', () => {
    const rows = [
      row(undefined, 9), row(null, 8), row('', 7), row(undefined, 6), row('CJG', 5)
    ];
    expect(capPerPlayer(rows, 3, 10).map((r) => r.score)).toEqual([9, 8, 7, 5]);
  });

  it('honours a cap of one', () => {
    const rows = [row('AAA', 9), row('AAA', 8), row('BBB', 7)];
    expect(capPerPlayer(rows, 1, 10).map((r) => r.score)).toEqual([9, 7]);
  });

  it('returns [] for an empty board', () => {
    expect(capPerPlayer([], 3, 10)).toEqual([]);
  });

  it('returns [] rather than throwing when the query yielded no array', () => {
    expect(capPerPlayer(null, 3, 10)).toEqual([]);
    expect(capPerPlayer(undefined, 3, 10)).toEqual([]);
  });

  it('does not mutate the rows it was given', () => {
    const rows = [row('AAA', 9), row('AAA', 8), row('AAA', 7), row('AAA', 6)];
    capPerPlayer(rows, 3, 10);
    expect(rows.length).toBe(4);
  });

  it('throws rather than defaulting a missing or nonsense quota', () => {
    const rows = [row('AAA', 1)];
    expect(() => capPerPlayer(rows, undefined, 10)).toThrow();
    expect(() => capPerPlayer(rows, 0, 10)).toThrow();
    expect(() => capPerPlayer(rows, 2.5, 10)).toThrow();
    expect(() => capPerPlayer(rows, -1, 10)).toThrow();
  });

  it('throws rather than defaulting a missing or nonsense limit', () => {
    const rows = [row('AAA', 1)];
    expect(() => capPerPlayer(rows, 3, undefined)).toThrow();
    expect(() => capPerPlayer(rows, 3, 0)).toThrow();
    expect(() => capPerPlayer(rows, 3, 1.5)).toThrow();
  });
});
