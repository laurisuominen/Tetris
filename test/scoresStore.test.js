/**
 * Local high-score table.
 *
 * This module had no coverage at all, which is how it kept clamping every name
 * to three uppercase characters for the whole of the accounts work — storing
 * the gamer tag `SALT` as `SAL` on the local board while the global board
 * showed it in full. The cases below pin both halves of the rule: a typed set
 * of initials is still clamped, an owned tag is not.
 *
 * `js/shared/storage/storage.js` reads `window.localStorage`, which does not
 * exist under Node, so a minimal in-memory stand-in is installed here. It is a
 * Map behind the two methods the wrapper calls — no dependency, and it behaves
 * the same in the browser runner, where the real `window` is left alone.
 */

import { describe, it, expect } from './harness.js';
import { createScoresStore } from '../js/shared/storage/scoresStore.js';

/* --- localStorage stand-in ------------------------------------------------ */

const memory = new Map();
const fakeStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => { memory.set(k, String(v)); },
};

// Only stub what is missing. In test/index.html `window` is the real thing and
// overwriting it would break the page running the tests.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = { localStorage: fakeStorage };
} else if (!globalThis.window.localStorage) {
  globalThis.window.localStorage = fakeStorage;
}

/** A fresh key per test, so no case can be polluted by the one before it. */
let counter = 0;
function freshStore() {
  counter += 1;
  const key = `test_scores_${counter}`;
  memory.delete(key);
  return createScoresStore(key);
}

/** Write a raw blob under a key, to simulate data an older build left behind. */
function seed(raw) {
  counter += 1;
  const key = `test_scores_${counter}`;
  window.localStorage.setItem(key, JSON.stringify(raw));
  return createScoresStore(key);
}

describe('scoresStore anonymous names', () => {
  it('clamps a typed name to exactly three uppercase characters', () => {
    const store = freshStore();
    store.saveScore({ score: 10, name: 'abcdef' });
    expect(store.loadScores()[0].name).toBe('ABC');
  });

  it('pads a short name rather than storing one character', () => {
    const store = freshStore();
    store.saveScore({ score: 10, name: 'z' });
    expect(store.loadScores()[0].name).toBe('ZAA');
  });

  it('strips punctuation and spaces', () => {
    const store = freshStore();
    store.saveScore({ score: 10, name: 'a-b c!' });
    expect(store.loadScores()[0].name).toBe('ABC');
  });

  it('falls back to AAA when no name is given', () => {
    const store = freshStore();
    store.saveScore({ score: 10 });
    expect(store.loadScores()[0].name).toBe('AAA');
  });

  it('marks the entry unverified', () => {
    const store = freshStore();
    store.saveScore({ score: 10, name: 'ABC' });
    expect(store.loadScores()[0].verified).toBe(false);
  });

  it('still accepts the legacy `initials` field name', () => {
    const store = freshStore();
    store.saveScore({ score: 10, initials: 'xyz' });
    expect(store.loadScores()[0].name).toBe('XYZ');
  });
});

describe('scoresStore verified gamer tags', () => {
  it('keeps the full tag instead of its first three characters', () => {
    const store = freshStore();
    store.saveScore({ score: 10, name: 'SALT', verified: true });
    expect(store.loadScores()[0].name).toBe('SALT');
  });

  it('preserves mixed case', () => {
    const store = freshStore();
    store.saveScore({ score: 10, name: 'Live30517', verified: true });
    expect(store.loadScores()[0].name).toBe('Live30517');
  });

  it('keeps hyphens and underscores, which tags allow', () => {
    const store = freshStore();
    store.saveScore({ score: 10, name: 'rick_dangerous', verified: true });
    expect(store.loadScores()[0].name).toBe('rick_dangerous');
  });

  it('keeps a full-length 15 character tag intact', () => {
    const store = freshStore();
    store.saveScore({ score: 10, name: 'abcdefghijklmno', verified: true });
    expect(store.loadScores()[0].name).toBe('abcdefghijklmno');
  });

  it('caps anything longer than a tag can be', () => {
    const store = freshStore();
    store.saveScore({ score: 10, name: 'abcdefghijklmnopqrstuvwxyz', verified: true });
    expect(store.loadScores()[0].name).toBe('abcdefghijklmno');
  });

  it('strips characters a tag cannot contain', () => {
    const store = freshStore();
    store.saveScore({ score: 10, name: 'sa lt!<>', verified: true });
    expect(store.loadScores()[0].name).toBe('salt');
  });

  it('marks the entry verified', () => {
    const store = freshStore();
    store.saveScore({ score: 10, name: 'SALT', verified: true });
    expect(store.loadScores()[0].verified).toBe(true);
  });

  it('falls back to initials rather than storing a blank name', () => {
    // Every character is stripped, so there is no tag left to show. A blank
    // name would render as an empty row; the placeholder is legible.
    const store = freshStore();
    store.saveScore({ score: 10, name: '!!!!', verified: true });
    expect(store.loadScores()[0].name).toBe('AAA');
  });

  it('does not claim verified when the tag sanitised away', () => {
    const store = freshStore();
    store.saveScore({ score: 10, name: '!!!!', verified: true });
    expect(store.loadScores()[0].verified).toBe(false);
  });
});

describe('scoresStore backward compatibility', () => {
  it('reads a row written before gamer tags existed', () => {
    const store = seed([{ score: 500, initials: 'JKH', date: '2026-07-01' }]);
    expect(store.loadScores()[0].name).toBe('JKH');
  });

  it('reports a legacy row as unverified', () => {
    const store = seed([{ score: 500, initials: 'JKH' }]);
    expect(store.loadScores()[0].verified).toBe(false);
  });

  it('keeps legacy rows alongside new ones', () => {
    const store = seed([{ score: 500, initials: 'JKH' }]);
    store.saveScore({ score: 900, name: 'SALT', verified: true });
    const names = store.loadScores().map((s) => s.name);
    expect(names).toEqual(['SALT', 'JKH']);
  });

  it('drops a row with no name of either kind', () => {
    const store = seed([{ score: 500 }, { score: 400, initials: 'ABC' }]);
    expect(store.loadScores().length).toBe(1);
  });

  it('treats a non-array blob as empty rather than throwing', () => {
    const store = seed({ not: 'an array' });
    expect(store.loadScores()).toEqual([]);
  });
});

describe('scoresStore ordering and cap', () => {
  it('sorts by score, highest first', () => {
    const store = freshStore();
    store.saveScore({ score: 100, name: 'LOW' });
    store.saveScore({ score: 900, name: 'TOP' });
    store.saveScore({ score: 500, name: 'MID' });
    expect(store.loadScores().map((s) => s.name)).toEqual(['TOP', 'MID', 'LOW']);
  });

  it('keeps at most ten entries', () => {
    const store = freshStore();
    for (let i = 1; i <= 15; i++) store.saveScore({ score: i * 10, name: 'AAA' });
    expect(store.loadScores().length).toBe(10);
  });

  it('drops the lowest score when full', () => {
    const store = freshStore();
    for (let i = 1; i <= 10; i++) store.saveScore({ score: i * 10, name: 'AAA' });
    store.saveScore({ score: 5, name: 'BBB' });
    expect(store.loadScores().some((s) => s.name === 'BBB')).toBe(false);
  });

  it('requires a storage key', () => {
    expect(() => createScoresStore()).toThrow();
  });

  it('does not count a zero score as a high score', () => {
    const store = freshStore();
    expect(store.isHighScore(0)).toBe(false);
  });

  it('counts any score as high while the table is not full', () => {
    const store = freshStore();
    expect(store.isHighScore(1)).toBe(true);
  });
});
