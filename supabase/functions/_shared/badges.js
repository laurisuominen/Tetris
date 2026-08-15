/**
 * The achievement badge catalogue, and the rule that decides who has earned what.
 *
 * WHERE IT LIVES AND WHY
 * ----------------------
 * `supabase/functions/_shared/` is Supabase's supported location for code shared
 * between Edge Functions — importing from outside `supabase/functions/` is not
 * reliably bundled on deploy. It is plain `.js` with zero imports and no Deno /
 * Node / DOM globals, because three runtimes load this exact file with no build
 * step between them: Deno (submit-score), Node (`test/run-node.mjs`) and the
 * browser (`test/index.html`, and `js/shared/achievements/badgeShelf.js`, which
 * imports it to render the shelf). Adding a dependency of any kind breaks at
 * least one of them. This is the gamerTag.js precedent, followed deliberately.
 *
 * Unlike gamerTag.js, NOTHING HERE IS SECRET. The blocklist in that file is
 * withheld from the client on purpose; this catalogue is meant to be read —
 * a badge nobody can see the criteria for is a badge nobody plays for. The
 * thresholds shipping to the browser is a feature.
 *
 * `evaluate()` IS PURE, and that is what makes it testable: (stats, run) in,
 * an array of keys out, no clock, no database, no randomness. It returns every
 * key the player QUALIFIES for, not the newly-unlocked ones — subtracting what
 * they already hold is the caller's job, and keeping that out of here is why
 * calling it twice with the same input gives the same answer.
 *
 * WHAT A BADGE MAY BE MADE OF
 * ---------------------------
 * Server-verifiable inputs only: the score, the game id, counters the database
 * maintains, and the row's own rank. In particular NOT
 * `session_duration_seconds` — CLAUDE.md records that it is client-supplied and
 * trivially forged, so a "played for an hour" badge would be a badge you type
 * rather than earn. A badge is then exactly as forgeable as a score already is
 * and adds no new attack surface.
 */

/* --- tiers ---------------------------------------------------------------- */

export const BRONZE = 'bronze';
export const SILVER = 'silver';
export const GOLD = 'gold';

/** Best-first, for picking the one mark shown beside a name on the board. */
export const TIER_ORDER = [GOLD, SILVER, BRONZE];

/* --- thresholds ----------------------------------------------------------- */

/** Plays, arcade-wide, for the grind tier. */
const PLAYS_TIERS = [10, 50, 200];

/** Distinct UTC days on which a score was submitted. */
const DAYS_TIERS = [3, 7];

/** The score the board has to be beaten to for the rank badges. */
const TOP_TEN = 10;

/**
 * Per-game score thresholds: [bronze, silver, gold].
 *
 * MEASURED, NOT INVENTED. CLAUDE.md forbids copying a number without a
 * derivation, and the existing anti-cheat ceilings show why it matters: Snake's
 * 12,000 and Breakout's 810,000 are derived from their engines, while Tetris's
 * 5,000 pts/sec is inherited from the single-game version and is flagged in
 * CLAUDE.md as still owing one. These are not engine ceilings — an engine
 * ceiling says what is POSSIBLE, and a badge threshold has to say what is
 * UNCOMMON — so they come from the distribution instead.
 *
 * Read from the live board 2026-08-15, GET
 * /rest/v1/leaderboard?select=game_id,score with the publishable key:
 *
 *   game      rows   min      p25      median   p75      p90      max
 *   tetris     100   34,892   45,264   71,078   95,592   108,318  166,814
 *   snake       87        7      240      540      630      780     1,060
 *   breakout   100       34       85      204      327      423     1,230
 *
 * Chosen so that, of the rows on the board that day:
 *
 *   tetris    50,000 -> 73%   75,000 -> 48%   110,000 ->  8%
 *   snake        250 -> 72%      550 -> 43%       800 -> 10%
 *   breakout     100 -> 74%      300 -> 30%       425 ->  9%
 *
 * which lands bronze and silver inside the 30-60% band the research recommends
 * for core achievements and gold inside the 5-15% band for elite ones.
 *
 * TWO HONEST CAVEATS, because the numbers look more precise than they are:
 *
 *   1. THE SAMPLE IS SURVIVORSHIP-BIASED. prune_leaderboard(100) had already
 *      deleted everything below the top 100 for tetris and breakout — both were
 *      at exactly 100 rows — so Tetris's "min" of 34,892 is the prune floor, not
 *      a beginner's score. Snake's 87 rows are its entire history. The
 *      percentages above are therefore "of scores good enough to still be on the
 *      board", which is a harder bar than "of all runs ever played". Bronze is
 *      set below the visible floor for Tetris on purpose.
 *   2. ROWS ARE NOT PLAYERS. One player's ten runs count ten times.
 *
 * Both push the same way — the real proportion of PLAYERS reaching each tier is
 * lower than the figure above — so these are, if anything, slightly hard. Revisit
 * once player_stats has enough history to ask the question per player, which is
 * exactly what that table is for.
 */
const SCORE_TIERS = {
  tetris:   [50_000, 75_000, 110_000],
  snake:    [250, 550, 800],
  breakout: [100, 300, 425]
};

/** Display names for the per-game badges. Keyed by the same ids as SCORE_TIERS. */
const GAME_TITLES = {
  tetris: 'Tetris',
  snake: 'Snake',
  breakout: 'Breakout'
};

/** The hidden one. Exactly, not at least — that is the joke. */
const LEET_SCORE = 1337;

/**
 * "Tetris, Snake and Breakout", built from the catalogue rather than typed.
 *
 * The Arcade Tourist badge requires EVERY game in SCORE_TIERS, so a fourth game
 * widens the criterion the moment it is added — and a description that still
 * named three would then be a lie the player is asked to act on.
 */
function gameListSentence() {
  const names = Object.keys(SCORE_TIERS).map((id) => GAME_TITLES[id] ?? id);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/* --- the catalogue -------------------------------------------------------- */

/**
 * Every badge, in the order a shelf should show them.
 *
 * Fields:
 *   key         stable identifier, stored in public.player_achievements
 *   title       shown to the player
 *   description how it is earned, in a complete sentence
 *   tier        BRONZE | SILVER | GOLD
 *   hidden      true = criteria not shown until earned
 *   game        game id, or null for arcade-wide
 *
 * ON THE COUNT. The research is consistent that a small arcade title ships
 * roughly 10-15 (Geometry Wars 2 and Pac-Man CE DX 12 each, Peggle 15). This is
 * 19, because nine of them are the same three-tier score ladder repeated across
 * three games — eleven distinct ideas, multiplied. A player who only plays Snake
 * sees three score badges, not nine, and the shelf groups by game. If it ever
 * reads as bloat the cut is the silver rung of each ladder, not the ladder.
 *
 * ONLY ONE IS HIDDEN, also on the research's advice: a hidden badge cannot be
 * played for, and a visible-but-vague one ("do something impressive") is the
 * worse failure of the two. Use it sparingly means once.
 */
export const BADGES = Object.freeze([
  {
    key: 'first-score',
    title: 'On the Board',
    description: 'Post your first score to the global leaderboard.',
    tier: BRONZE,
    hidden: false,
    game: null
  },
  {
    key: 'all-three',
    title: 'Arcade Tourist',
    description: `Post a score in ${gameListSentence()}.`,
    tier: BRONZE,
    hidden: false,
    game: null
  },
  {
    key: 'plays-10',
    title: 'Regular',
    description: 'Play 10 games, in any mix.',
    tier: BRONZE,
    hidden: false,
    game: null
  },
  {
    key: 'plays-50',
    title: 'Local Legend',
    description: 'Play 50 games, in any mix.',
    tier: SILVER,
    hidden: false,
    game: null
  },
  {
    key: 'plays-200',
    title: 'Cabinet Fixture',
    description: 'Play 200 games, in any mix.',
    tier: GOLD,
    hidden: false,
    game: null
  },
  {
    key: 'days-3',
    title: 'Coming Back',
    description: 'Play on 3 different days.',
    tier: BRONZE,
    hidden: false,
    game: null
  },
  {
    key: 'days-7',
    title: 'Week Long',
    description: 'Play on 7 different days.',
    tier: SILVER,
    hidden: false,
    game: null
  },

  // The three score ladders are generated rather than typed out, so a threshold
  // can only ever be changed in SCORE_TIERS. Two copies of a number is how one
  // of them goes stale.
  ...Object.keys(SCORE_TIERS).flatMap((gameId) =>
    SCORE_TIERS[gameId].map((threshold, index) => ({
      key: `score-${gameId}-${index + 1}`,
      title: `${GAME_TITLES[gameId]} ${['Bronze', 'Silver', 'Gold'][index]}`,
      description: `Score ${threshold.toLocaleString('en-US')} in ${GAME_TITLES[gameId]}.`,
      tier: [BRONZE, SILVER, GOLD][index],
      hidden: false,
      game: gameId
    }))
  ),

  {
    key: 'top-ten',
    title: 'Top Ten',
    description: 'Land a score in the global top 10 of any game.',
    tier: SILVER,
    hidden: false,
    game: null
  },
  {
    key: 'rank-one',
    title: 'High Score Holder',
    description: 'Take the number one spot on any global board.',
    tier: GOLD,
    hidden: false,
    game: null
  },
  {
    key: 'leet',
    title: 'Elite',
    description: `Finish a game on exactly ${LEET_SCORE} points.`,
    tier: BRONZE,
    hidden: true,
    game: null
  }
]);

/** key -> badge, built once. */
const BY_KEY = Object.freeze(
  BADGES.reduce((map, badge) => {
    map[badge.key] = badge;
    return map;
  }, Object.create(null))
);

/**
 * The badge with this key, or null.
 *
 * Null rather than throwing, and the reason is a real one: a browser holding a
 * cached copy of this file can be shown a key awarded by a newer deploy of the
 * Edge Function. An unknown badge should render as nothing, not take the shelf
 * down with it.
 */
export function badgeFor(key) {
  return BY_KEY[key] ?? null;
}

/**
 * The best tier among a set of earned keys, or null for none.
 *
 * This is what the leaderboard shows beside a name: one mark, not nineteen.
 */
export function bestTier(keys) {
  if (!Array.isArray(keys)) return null;
  const held = new Set(keys.map((key) => badgeFor(key)?.tier).filter(Boolean));
  return TIER_ORDER.find((tier) => held.has(tier)) ?? null;
}

/* --- the rule ------------------------------------------------------------- */

function isPositiveInt(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Every badge key the player now qualifies for.
 *
 * @param {object} stats   totals AFTER this run has been counted, as
 *                         public.record_play returns them:
 *                           plays      {number} arcade-wide submissions
 *                           games      {string[]} game ids ever played
 *                           bestScore  {number} best ever in `run.gameId`
 *                           days       {number} distinct UTC days played
 * @param {object} run     this submission:
 *                           gameId {string}
 *                           score  {number}
 *                           rank   {number|null} raw rank on the global board,
 *                                  1-based. NULL means "not established" and is
 *                                  treated as not qualifying — never as rank 1.
 * @returns {string[]} keys, in catalogue order. Never null.
 *
 * ORDER IS CATALOGUE ORDER, not evaluation order, so two callers comparing
 * results do not have to sort first.
 */
export function evaluate(stats, run) {
  const earned = new Set();

  const plays = isPositiveInt(stats?.plays) ? stats.plays : 0;
  const days = isPositiveInt(stats?.days) ? stats.days : 0;
  const bestScore = isPositiveInt(stats?.bestScore) ? stats.bestScore : 0;
  const games = Array.isArray(stats?.games) ? stats.games : [];

  const gameId = typeof run?.gameId === 'string' ? run.gameId : '';
  const score = isPositiveInt(run?.score) ? run.score : 0;
  // A rank of 0 or a negative would be nonsense from a miscounted query; treat
  // anything that is not a positive integer as "unknown" rather than as first.
  const rank = Number.isInteger(run?.rank) && run.rank > 0 ? run.rank : null;

  // Milestone. `plays` counts this run, so it is 1 on the very first one.
  if (plays >= 1) earned.add('first-score');

  // Exploration. Every game in the catalogue, not merely three of them — a
  // fourth game must widen this badge rather than let it be earned without
  // touching the new one.
  const played = new Set(games);
  if (Object.keys(SCORE_TIERS).every((id) => played.has(id))) earned.add('all-three');

  // Grind.
  PLAYS_TIERS.forEach((threshold) => {
    if (plays >= threshold) earned.add(`plays-${threshold}`);
  });

  // Consistency.
  DAYS_TIERS.forEach((threshold) => {
    if (days >= threshold) earned.add(`days-${threshold}`);
  });

  // Skill, per game. Keyed off bestScore rather than this run's score so a
  // player who beat the threshold last week and is having a bad night still
  // holds the badge — and so a badge added later awards itself from the counter.
  const tiers = SCORE_TIERS[gameId];
  if (tiers) {
    tiers.forEach((threshold, index) => {
      if (bestScore >= threshold) earned.add(`score-${gameId}-${index + 1}`);
    });
  }

  // Rank. THE RAW RANK, not the one the board displays.
  //
  // fetchTopScores caps each name at three rows (js/shared/net/topScores.js), so
  // a player can hold raw rank 4 while appearing second on screen. The badge
  // means what the table says, because the table is what it is a claim about.
  if (rank !== null && rank <= TOP_TEN) earned.add('top-ten');
  if (rank === 1) earned.add('rank-one');

  // Secret.
  if (score === LEET_SCORE) earned.add('leet');

  return BADGES.filter((badge) => earned.has(badge.key)).map((badge) => badge.key);
}

/* Exported for the tests, which assert the catalogue against the thresholds
   rather than against a second copy of them. */
export { SCORE_TIERS, PLAYS_TIERS, DAYS_TIERS, TOP_TEN, LEET_SCORE };
