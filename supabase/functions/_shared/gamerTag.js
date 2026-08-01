/**
 * Gamer tag validation: shape rules, a uniqueness key, and a word filter.
 *
 * WHAT THIS IS NOT
 * ----------------
 * The blocklist at the bottom of this file is a speed bump, not a wall. It
 * raises the cost of picking an abusive name rather than preventing it. It
 * misses novel spellings, misses every language it does not cover (this list is
 * English only), and misses anything assembled out of individually-innocent
 * words. This repository is public, so the list itself is public: anyone who
 * wants to route around it can read exactly how. The real remedy is the
 * report-and-ban path, and a filter that pretends otherwise is worse than no
 * filter, because it invites trusting the output.
 *
 * The design goal is therefore NOT "catch everything". It is "catch the lazy
 * attempts, and never block a real person's name". A false positive costs a
 * player their name; a false negative costs a report. Those are not symmetric,
 * and the two-tier list below is how that asymmetry is expressed.
 *
 * WHERE IT LIVES AND WHY
 * ----------------------
 * `supabase/functions/_shared/` is Supabase's supported location for code
 * shared between Edge Functions — importing from outside `supabase/functions/`
 * is not reliably bundled on deploy. It is plain `.js` with zero imports and no
 * Deno / Node / DOM globals, because three runtimes load this exact file with no
 * build step between them: Deno (the Edge Function), Node (`test/run-node.mjs`)
 * and the browser (`test/index.html`). Adding a dependency of any kind breaks
 * at least one of them.
 */

/* --- player-facing messages ----------------------------------------------- */
/* Every `reason` is a complete sentence, shown verbatim in the sign-up UI. */

const NOT_TEXT = 'Gamer tags must be text.';
const LENGTH = 'Gamer tags must be 3 to 15 characters.';
const CHARSET = 'Gamer tags can only use letters, numbers, hyphens and underscores.';
const EDGES = 'Gamer tags must start and end with a letter or number.';
const DOUBLE_SEP = 'Gamer tags cannot use two hyphens or underscores in a row.';
const RESERVED_REASON = 'That gamer tag is reserved. Please choose another one.';
const BLOCKED_REASON = 'That gamer tag is not allowed. Please choose another one.';

const MIN_LENGTH = 3;
const MAX_LENGTH = 15;

/**
 * The uniqueness key: lowercase, with `_` and `-` removed.
 *
 * `Lauri`, `lauri`, `L_a_u_r_i` and `l-a-u-r-i` therefore collapse to one key
 * and only the first of them can be registered. That is impersonation defence,
 * not tidiness — separators and case are the cheapest way to stand next to
 * someone else's name on a leaderboard and be mistaken for them.
 *
 * @param {unknown} tag
 * @returns {string} '' for anything that is not a string.
 */
export function normalizeKey(tag) {
  if (typeof tag !== 'string') return '';
  return tag.trim().toLowerCase().replace(/[_-]/g, '');
}

/** Leetspeak substitutions, applied character by character. */
const LEET = Object.freeze({
  '4': 'a', '3': 'e', '1': 'i', '0': 'o', '5': 's', '7': 't',
  $: 's', '@': 'a', '!': 'i'
});

/**
 * The moderation matching form. Used ONLY for blocklist comparison — never for
 * uniqueness, never for display. It is deliberately lossy, and every step
 * throws away a different evasion:
 *
 *   1. lowercase          — `FUCK` and `FuCk` are the same word.
 *   2. fold leetspeak     — `sh1t`, `@ss`, `b00bs`, `n1gg3r` are the same words.
 *   3. strip non-alphanumerics — `f_u_c_k`, `f.u.c.k`, `f u c k` are the same word.
 *   4. collapse repeated runs  — `fuuuck`, `fuuuuuuck` are the same word.
 *
 * Step 4 is the destructive one and its side effects are load-bearing, so they
 * are spelled out where they matter: see the note above BLOCKED_EXACT.
 *
 * @param {unknown} tag
 * @returns {string} '' for anything that is not a string.
 */
export function normalizeForMatch(tag) {
  return collapseRuns(normalizeLoose(tag));
}

/** Runs of the same character reduced to one. `fuuuck` -> `fuck`. */
const collapseRuns = (text) => text.replace(/(.)\1+/g, '$1');

/**
 * The same folding WITHOUT the run-collapse step.
 *
 * The collapse is what catches `fuuuck`, but on its own it is far too blunt to
 * be the only matching form, because it also collapses the blocklist. Store a
 * term like `boobs` collapsed and it becomes `bobs` — which then blocks the
 * perfectly ordinary tag `Bobs`. Likewise `ass` collapses to `as` and takes
 * every tag that normalizes to it.
 *
 * So the blocklist is stored in this LOOSE form, and a candidate is tested in
 * both forms (see matchesBlocklist). Each form catches what the other cannot:
 *
 *   boobs   loose `boobs`  -> hits the loose term `boobs`
 *   b00bs   loose `boobs`  -> hits it too, via the leet fold
 *   fuuuck  loose `fuuuck` misses; collapses onto `fuck`    -> BLOCKED
 *   Bobs    loose `bobs`   misses; collapses onto `boobs`, but see below
 *
 * The collapsed comparison carries a length guard, and that guard is what
 * separates `asss` from `Bobs`. Padding a term with repeats can only make a tag
 * LONGER — nobody evades `ass` by typing something shorter. So a collapsed
 * match counts only when the candidate is at least as long as the term it
 * collapsed onto:
 *
 *   asss (4) collapses onto ass (3)    4 >= 3  -> BLOCKED, it is padding
 *   Bobs (4) collapses onto boobs (5)  4 <  5  -> ALLOWED, it is a shorter word
 *
 * @param {unknown} tag
 * @returns {string} '' for anything that is not a string.
 */
export function normalizeLoose(tag) {
  if (typeof tag !== 'string') return '';
  return tag
    .toLowerCase()
    .replace(/[431057$@!]/g, (char) => LEET[char])
    .replace(/[^a-z0-9]/g, '');
}

/**
 * @typedef {{ ok: true, tag: string, key: string }} GamerTagAccepted
 * @typedef {{ ok: false, reason: string }} GamerTagRejected
 */

/**
 * Validate a gamer tag.
 *
 * Shape rules are checked most-specific-message-last so the player is told the
 * one thing that is actually wrong: length, then character set, then the edge
 * characters, then repeated separators. Reserved words and the blocklist run
 * only on a tag that is already well-formed.
 *
 * @param {unknown} tag
 * @returns {GamerTagAccepted | GamerTagRejected}
 */
export function validateGamerTag(tag) {
  if (typeof tag !== 'string') return { ok: false, reason: NOT_TEXT };

  const trimmed = tag.trim();

  if (trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH) {
    return { ok: false, reason: LENGTH };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return { ok: false, reason: CHARSET };
  }
  if (!/^[A-Za-z0-9]/.test(trimmed) || !/[A-Za-z0-9]$/.test(trimmed)) {
    return { ok: false, reason: EDGES };
  }
  if (/[_-]{2}/.test(trimmed)) {
    return { ok: false, reason: DOUBLE_SEP };
  }

  const key = normalizeKey(trimmed);
  if (RESERVED.has(key)) return { ok: false, reason: RESERVED_REASON };

  // Tier 1: anywhere inside the tag.
  if (containsBlocked(trimmed)) return { ok: false, reason: BLOCKED_REASON };

  // Tier 2: the whole tag, or one separator-delimited token of it.
  if (isBlockedExact(trimmed)) return { ok: false, reason: BLOCKED_REASON };
  for (const token of trimmed.split(/[_-]+/)) {
    if (token && isBlockedExact(token)) return { ok: false, reason: BLOCKED_REASON };
  }

  return { ok: true, tag: trimmed, key };
}

/* ========================================================================== */
/* THE LISTS. Explicit language below, by necessity — this is the word filter. */
/* ========================================================================== */

/**
 * Names the arcade needs for itself, or that would let a player pose as staff.
 * Compared against `normalizeKey`, so `AdMiN`, `a_d_m_i_n` and `A-D-M-I-N` are
 * all the same reservation.
 */
const RESERVED = new Set([
  'admin', 'administrator', 'mod', 'moderator', 'staff', 'support', 'official',
  'arcade', 'system', 'root', 'owner', 'anonymous', 'deleted', 'banned',
  'null', 'undefined', 'none'
]);

/**
 * TIER 1 — matched ANYWHERE inside `normalizeForMatch(tag)`.
 *
 * Every entry here is a Scunthorpe risk by construction: it fires on substrings,
 * so it will eventually fire inside a word nobody intended. The bar for adding
 * one is "no innocent English word or surname contains this", and the list is
 * kept to four entries on purpose. If a legitimate name is ever blocked, the fix
 * is to move the term down to TIER 2, never to soften the test that caught it.
 *
 * Justification, one line each:
 *   fuck   — no English word contains it; catches `motherfucker`, `fuckboy`.
 *   faggot — normalizes to `fagot`; the only near-collision is the Italian
 *            musical term "fagotto", judged acceptable against a hard slur.
 *   whore  — no English word contains it; catches `whorehouse`.
 *   hitler — no English word contains it, and the hate reference is the point.
 *
 * Terms that LOOK like they belong here and do not, with the word they break:
 *   cunt (Scunthorpe), cock (Hancock, Cockburn), anal (analysis),
 *   penis (Penistone), rape (Grape), shit (Shiitake), ass (Bassett),
 *   spic (suspicious), jap (Japan), paki (Pakistan), nigger (Nigeria),
 *   nazi (Nazir), pedo (pedometer). All of those live in TIER 2.
 */
const BLOCKED_CONTAINS = Object.freeze([
  'fuck',
  'faggot',
  'whore',
  'hitler'
]);

/**
 * TIER 2 — matched only against the WHOLE normalized tag, or against a single
 * separator-delimited token of it. This is where nearly everything belongs.
 *
 * Two consequences of the collapse step in `normalizeForMatch` are visible here
 * and are accepted knowingly:
 *
 *   - `ass` normalizes to `as` and `boobs` to `bobs`, so the tags `As` and
 *     `Bobs` are collateral damage. Catching `@ss` and `b00bs` is worth it;
 *     catching them any other way means not collapsing runs, which loses
 *     `fuuuck`.
 *   - Some terms cannot be listed at all because collapsing destroys them:
 *     `kkk` becomes `k` (which would block every tag containing a k), and the
 *     neo-Nazi numerics `88` / `1488` become `8` / `ia8`. `coon` becomes `con`
 *     and would take "Con" and "Connor" with it. Those four are deliberately
 *     absent — they are the report-and-ban path's problem, not this file's.
 *
 * Entries are written in plain form; they are normalized at load, so listing
 * both `nigger` and `n1gg3r` would be redundant.
 */
const BLOCKED_EXACT = Object.freeze([
  /* --- racial and ethnic slurs --- */
  'nigger', 'niggers', 'nigga', 'niggas', 'sandnigger', 'junglebunny',
  'porchmonkey', 'tarbaby', 'darkie', 'darky', 'negro',
  'chink', 'chinks', 'gook', 'zipperhead', 'slanteye', 'jap', 'japs',
  'spic', 'spics', 'spick', 'beaner', 'wetback', 'greaser',
  'kike', 'kikes', 'heeb', 'yid',
  'paki', 'pakis', 'raghead', 'towelhead', 'cameljockey', 'sandmonkey',
  'wop', 'dago', 'gyppo', 'pikey', 'golliwog',
  'redskin', 'squaw', 'injun', 'halfbreed',

  /* --- homophobic and transphobic slurs --- */
  'fag', 'fags', 'dyke', 'dykes', 'homo', 'poofter', 'battyboy',
  'tranny', 'trannies', 'shemale', 'ladyboy', 'fudgepacker', 'buttpirate',

  /* --- ableist slurs --- */
  'retard', 'retards', 'retarded', 'spastic', 'mongoloid',

  /* --- Nazi and hate references --- */
  'nazi', 'nazis', 'neonazi', 'siegheil', 'heilhitler', 'fuhrer', 'thirdreich',
  'swastika', 'whitepower', 'whitepride', 'gaschamber',

  /* --- sexual obscenity --- */
  'anal', 'anus', 'ass', 'asshole', 'arse', 'arsehole', 'dumbass', 'jackass',
  'bitch', 'bitches', 'bastard', 'bollocks', 'boobs', 'boobies', 'tits',
  'titties', 'titty', 'blowjob', 'handjob', 'rimjob', 'bukkake', 'buttplug',
  'cameltoe', 'clit', 'cock', 'cocksucker', 'creampie', 'cum', 'cumshot',
  'cunt', 'cunts', 'deepthroat', 'dick', 'dickhead', 'dildo', 'fap',
  'fisting', 'gangbang', 'hentai', 'horny', 'incest', 'jizz', 'masturbate',
  'milf', 'nipple', 'nipples', 'nutsack', 'orgy', 'penis', 'porn', 'porno',
  'prick', 'pube', 'pubes', 'pussy', 'queef', 'sex', 'shag', 'slut', 'sluts',
  'strapon', 'threesome', 'twat', 'vagina', 'viagra', 'wank', 'wanker',

  /* --- general obscenity --- */
  'shit', 'shits', 'bullshit', 'shithead', 'piss', 'pissed', 'bellend',
  'bugger', 'knobhead', 'minge', 'tosser',

  /* --- violence and abuse --- */
  'rape', 'rapist', 'molest', 'molester', 'pedo', 'pedophile', 'paedophile',
  'kys', 'killyourself'
]);

/* Precomputed so a submission does not re-normalize the whole list. */
// Terms are stored LOOSE (no run-collapse). Collapsing the list is what used
// to turn `boobs` into `bobs` and block the name Bobs; candidates are tested in
// both forms instead, so nothing is lost by keeping the list uncollapsed.
const CONTAINS_TERMS = Object.freeze(
  BLOCKED_CONTAINS.map(normalizeLoose).filter(Boolean)
);
const EXACT_TERMS = new Set(BLOCKED_EXACT.map(normalizeLoose).filter(Boolean));

/**
 * Collapsed form -> the length of the SHORTEST term that collapses to it.
 *
 * The length is the guard described above normalizeLoose: a collapsed match
 * only counts when the candidate is at least as long as the term, because
 * repeat-padding can only lengthen a tag. Shortest wins so that the most
 * permissive term decides — if both `ass` and `aass` existed, `asss` should
 * still be caught.
 */
function collapsedLengths(terms) {
  const map = new Map();
  for (const term of terms) {
    const collapsed = collapseRuns(term);
    const existing = map.get(collapsed);
    if (existing === undefined || term.length < existing) map.set(collapsed, term.length);
  }
  return map;
}

const EXACT_COLLAPSED = collapsedLengths(EXACT_TERMS);
const CONTAINS_COLLAPSED = collapsedLengths(CONTAINS_TERMS);

/** Tier 1: a blocked term appearing anywhere inside the tag. */
function containsBlocked(text) {
  const loose = normalizeLoose(text);
  for (const term of CONTAINS_TERMS) {
    if (loose.includes(term)) return true;
  }

  const collapsed = collapseRuns(loose);
  for (const [term, length] of CONTAINS_COLLAPSED) {
    if (loose.length >= length && collapsed.includes(term)) return true;
  }
  return false;
}

/** Tier 2: the text IS a blocked term, in either folded form. */
function isBlockedExact(text) {
  const loose = normalizeLoose(text);
  if (EXACT_TERMS.has(loose)) return true;

  const length = EXACT_COLLAPSED.get(collapseRuns(loose));
  return length !== undefined && loose.length >= length;
}
