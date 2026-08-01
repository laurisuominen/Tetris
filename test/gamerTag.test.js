/**
 * Gamer tag tests.
 *
 * The Scunthorpe suite is the one that actually constrains the design. Anyone
 * can write a word filter that rejects `fuck`; the hard part is a filter that
 * still lets a player from Scunthorpe, a Cockburn or a Bassett keep their own
 * name, and that is what forces almost every term into the exact-match tier.
 * If one of those cases ever fails, the fix is in the blocklist, not here.
 *
 * The module under test is loaded by Deno (the Edge Function), Node and the
 * browser, so these tests are plain synchronous assertions over pure functions.
 */

import { describe, it, expect } from './harness.js';
import {
  normalizeKey, normalizeForMatch, validateGamerTag
} from '../supabase/functions/_shared/gamerTag.js';

/* The player-facing strings, duplicated on purpose: the exact wording is the
 * contract with the sign-up UI, so a reword should break a test. */
const NOT_TEXT = 'Gamer tags must be text.';
const LENGTH = 'Gamer tags must be 3 to 15 characters.';
const CHARSET = 'Gamer tags can only use letters, numbers, hyphens and underscores.';
const EDGES = 'Gamer tags must start and end with a letter or number.';
const DOUBLE_SEP = 'Gamer tags cannot use two hyphens or underscores in a row.';
const RESERVED_REASON = 'That gamer tag is reserved. Please choose another one.';
const BLOCKED_REASON = 'That gamer tag is not allowed. Please choose another one.';

/** Assert a tag is rejected for a specific reason. */
function rejects(tag, reason) {
  const result = validateGamerTag(tag);
  expect(result.ok).toBe(false);
  expect(result.reason).toBe(reason);
}

/** Assert a tag is accepted, and return the result for further assertions. */
function accepts(tag) {
  const result = validateGamerTag(tag);
  // Surfaces the reason in the failure message instead of a bare "false".
  expect(result.ok ? true : result.reason).toBe(true);
  return result;
}

/* --- shape ---------------------------------------------------------------- */

describe('gamerTag shape: type and length', () => {
  it('rejects a non-string', () => {
    rejects(undefined, NOT_TEXT);
    rejects(null, NOT_TEXT);
    rejects(1234, NOT_TEXT);
    rejects(['Lauri'], NOT_TEXT);
  });

  it('rejects a tag shorter than 3 characters', () => {
    rejects('ab', LENGTH);
    rejects('a', LENGTH);
    rejects('', LENGTH);
  });

  it('rejects a tag longer than 15 characters', () => {
    rejects('abcdefghijklmnop', LENGTH);
  });

  it('accepts the length boundaries', () => {
    expect(accepts('abc').tag).toBe('abc');
    expect(accepts('abcdefghijklmno').tag).toBe('abcdefghijklmno');
  });

  it('trims before measuring, and returns the trimmed tag', () => {
    expect(accepts('  Lauri  ').tag).toBe('Lauri');
    rejects('  a  ', LENGTH);
    rejects('   ', LENGTH);
  });

  it('checks length before the character set, so short junk reads as too short', () => {
    rejects('!!', LENGTH);
  });
});

describe('gamerTag shape: character set', () => {
  it('rejects characters outside [A-Za-z0-9_-]', () => {
    rejects('Lauri!', CHARSET);
    rejects('Lauri.', CHARSET);
    rejects('Lauri Suominen', CHARSET);
    rejects('Lauri@home', CHARSET);
    rejects('Läuri', CHARSET);
    rejects('Lauri😀', CHARSET);
  });

  it('accepts letters, digits, hyphen and underscore', () => {
    expect(accepts('a-b_c9').ok).toBe(true);
  });
});

describe('gamerTag shape: edges and separators', () => {
  it('rejects a leading separator', () => {
    rejects('_Lauri', EDGES);
    rejects('-Lauri', EDGES);
  });

  it('rejects a trailing separator', () => {
    rejects('Lauri_', EDGES);
    rejects('Lauri-', EDGES);
  });

  it('rejects a tag made only of separators', () => {
    rejects('___', EDGES);
  });

  it('reports edges before repeated separators, the more specific fault first', () => {
    rejects('__Lauri', EDGES);
  });

  it('rejects two separators in a row, in any combination', () => {
    rejects('La__uri', DOUBLE_SEP);
    rejects('La--uri', DOUBLE_SEP);
    rejects('La-_uri', DOUBLE_SEP);
    rejects('La_-uri', DOUBLE_SEP);
  });

  it('accepts single separators between alphanumerics', () => {
    expect(accepts('L_a-u_r-i').ok).toBe(true);
  });
});

/* --- the uniqueness key --------------------------------------------------- */

describe('gamerTag normalizeKey', () => {
  it('lowercases and strips underscores and hyphens', () => {
    expect(normalizeKey('L_a-u_r-i')).toBe('lauri');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeKey('  Lauri  ')).toBe('lauri');
  });

  it('returns an empty string for a non-string', () => {
    expect(normalizeKey(null)).toBe('');
    expect(normalizeKey(42)).toBe('');
  });

  it('collapses the impersonation variants of one name to one key', () => {
    const variants = ['Lauri', 'lauri', 'L_a_u_r_i', 'l-a-u-r-i'];
    for (const variant of variants) expect(normalizeKey(variant)).toBe('lauri');
  });

  it('exposes that same key on an accepted result', () => {
    const variants = ['Lauri', 'lauri', 'L_a_u_r_i', 'l-a-u-r-i'];
    for (const variant of variants) expect(accepts(variant).key).toBe('lauri');
  });

  it('does not fold digits, which are a real distinction between players', () => {
    expect(normalizeKey('Lauri1')).toBe('lauri1');
  });
});

/* --- the matching form ---------------------------------------------------- */

describe('gamerTag normalizeForMatch', () => {
  it('lowercases', () => {
    expect(normalizeForMatch('DRAGON')).toBe('dragon');
  });

  it('folds every leetspeak substitution', () => {
    expect(normalizeForMatch('4')).toBe('a');
    expect(normalizeForMatch('3')).toBe('e');
    expect(normalizeForMatch('1')).toBe('i');
    expect(normalizeForMatch('0')).toBe('o');
    expect(normalizeForMatch('5')).toBe('s');
    expect(normalizeForMatch('7')).toBe('t');
    expect(normalizeForMatch('$')).toBe('s');
    expect(normalizeForMatch('@')).toBe('a');
    expect(normalizeForMatch('!')).toBe('i');
  });

  it('leaves digits with no leet meaning alone', () => {
    expect(normalizeForMatch('2689')).toBe('2689');
  });

  it('strips every non-alphanumeric character', () => {
    expect(normalizeForMatch('d.r-a_g o+n')).toBe('dragon');
  });

  it('collapses runs of the same character to one', () => {
    expect(normalizeForMatch('draaaagon')).toBe('dragon');
    expect(normalizeForMatch('aaaaa')).toBe('a');
  });

  it('collapses after stripping, so separated doubles also collapse', () => {
    expect(normalizeForMatch('d-r-a-g-o-n')).toBe('dragon');
    expect(normalizeForMatch('b-o-o-m')).toBe('bom');
  });

  it('applies the steps in order: lowercase, leet, strip, collapse', () => {
    expect(normalizeForMatch('D_R@@@G0N!')).toBe('dragoni');
  });

  it('returns an empty string for a non-string', () => {
    expect(normalizeForMatch(null)).toBe('');
    expect(normalizeForMatch(7)).toBe('');
  });
});

/* --- reserved words ------------------------------------------------------- */

describe('gamerTag reserved words', () => {
  const reserved = [
    'admin', 'administrator', 'mod', 'moderator', 'staff', 'support',
    'official', 'arcade', 'system', 'root', 'owner', 'anonymous', 'deleted',
    'banned', 'null', 'undefined', 'none'
  ];

  for (const word of reserved) {
    it(`rejects "${word}"`, () => rejects(word, RESERVED_REASON));
  }

  it('rejects reserved words regardless of case or separators', () => {
    rejects('AdMiN', RESERVED_REASON);
    rejects('a_d_m_i_n', RESERVED_REASON);
    rejects('A-D-M-I-N', RESERVED_REASON);
  });

  it('does not reject a longer tag that merely starts with a reserved word', () => {
    expect(accepts('admiral').ok).toBe(true);
    expect(accepts('rooted').ok).toBe(true);
    expect(accepts('modest').ok).toBe(true);
  });
});

/* --- the blocklist -------------------------------------------------------- */

describe('gamerTag blocklist: plain terms', () => {
  const blocked = [
    'fuck', 'shit', 'cunt', 'bitch', 'nigger', 'faggot', 'retard', 'nazi',
    'rapist', 'pedo', 'whore', 'hitler'
  ];

  for (const word of blocked) {
    it(`rejects "${word}"`, () => rejects(word, BLOCKED_REASON));
  }
});

describe('gamerTag blocklist: evasion', () => {
  it('catches leetspeak', () => {
    rejects('sh1t', BLOCKED_REASON);
    rejects('b00bs', BLOCKED_REASON);
    rejects('n1gg3r', BLOCKED_REASON);
    rejects('5hit', BLOCKED_REASON);
  });

  it('rejects `@ss`, but on the character set rule rather than the blocklist', () => {
    // `@`, `$` and `!` cannot survive the character-set rule, so for a whole tag
    // those three folds are unreachable — the tag is rejected earlier, and more
    // specifically. The folds still matter to normalizeForMatch itself, which is
    // asserted directly below, and would matter to any future caller that
    // moderates a string this shape rule does not govern.
    rejects('@ss', CHARSET);
    expect(normalizeForMatch('@ss')).toBe(normalizeForMatch('ass'));
    expect(normalizeForMatch('$hit')).toBe(normalizeForMatch('shit'));
  });

  it('catches separator padding', () => {
    rejects('f_u_c_k', BLOCKED_REASON);
    rejects('s-h-i-t', BLOCKED_REASON);
  });

  it('catches character repetition', () => {
    rejects('fuuuck', BLOCKED_REASON);
    rejects('shiiiit', BLOCKED_REASON);
  });

  it('catches leet and padding combined', () => {
    rejects('n1-gg-3r', BLOCKED_REASON);
    rejects('F_U_C_K', BLOCKED_REASON);
  });

  it('catches a tier-1 term buried inside a longer tag', () => {
    rejects('xXfuckboyXx', BLOCKED_REASON);
    rejects('mrhitler99', BLOCKED_REASON);
  });

  it('catches a tier-2 term as a separator-delimited token', () => {
    rejects('xX_cunt_Xx', BLOCKED_REASON);
    rejects('big-dick-energy', BLOCKED_REASON);
  });

  it('does not treat a tier-2 term as tier 1', () => {
    // `cunt` inside a longer unseparated word is not matched — that is exactly
    // the concession that keeps Scunthorpe working, and it is deliberate.
    expect(accepts('cuntfield').ok).toBe(true);
  });
});

describe('gamerTag blocklist: the Scunthorpe problem', () => {
  // Real place names, surnames and ordinary words, each containing a term that
  // a naive substring filter would fire on. Every one of these MUST be accepted.
  const legitimate = [
    'Scunthorpe',   // cunt
    'Cockburn',     // cock
    'Hancock',      // cock
    'Penistone',    // penis
    'Bassett',      // ass
    'assassin',     // ass
    'classic',      // ass
    'analysis',     // anal
    'Grape',        // rape
    'Shiitake',     // shit
    'suspicious',   // spic
    'Japan',        // jap
    'Pakistan',     // paki
    'Nigeria',      // nigger, once leet-folded and collapsed
    'Nazir',        // nazi
    'Pedometer',    // pedo
    'Mongolia',     // mongoloid
    'therapist'     // rapist
  ];

  for (const word of legitimate) {
    it(`accepts "${word}"`, () => expect(accepts(word).ok).toBe(true));
  }
});

describe('gamerTag accepts ordinary tags', () => {
  const good = ['Lauri', 'xX_Dragon_Xx', 'player-one', 'A1b2'];

  for (const tag of good) {
    it(`accepts "${tag}"`, () => {
      const result = accepts(tag);
      expect(result.tag).toBe(tag);
      expect(result.key).toBe(normalizeKey(tag));
    });
  }

  it('returns no reason on an accepted tag', () => {
    expect(accepts('Lauri').reason).toBe(undefined);
  });
});
