/**
 * End-to-end verification of the accounts flow against the LOCAL Supabase stack.
 *
 * NOT part of `node test/run-node.mjs`, and deliberately not registered in
 * test/index.html either. Every other suite in this directory is pure, offline
 * and dependency-free; this one needs Docker, a running `supabase start`, and
 * it WRITES to the local database. Wiring it into the default run would mean
 * `node test/run-node.mjs` fails on any machine without Docker up, which is the
 * fastest way to teach people to ignore a red suite.
 *
 * It exists because the things it covers cannot be unit tested at all: the auth
 * hook firing inside the signup transaction, the column-level grants, the
 * generated `is_verified` column recomputing on account deletion, the 6-digit
 * code actually arriving, and — since badges landed — a badge being awarded
 * exactly once by the server and cascading away with the account. Those were
 * reviewed-not-verified for the whole of the accounts work.
 *
 * `supabase functions serve` with NO function name: this suite calls
 * submit-score, report-name and delete-account, and the signup hook calls
 * before-user-created. Serving only one of them fails in section 7.
 *
 *   supabase start
 *   supabase functions serve
 *   node test/e2e-accounts.mjs
 *
 * Re-runnable: every run mints a fresh email and gamer tag, so it accumulates
 * rows rather than colliding. `supabase db reset` clears them.
 *
 * The key below is the CLI's fixed local publishable key — not a secret, and it
 * authenticates against nothing but 127.0.0.1. See js/shared/net/client.js.
 */
const BASE = 'http://127.0.0.1:54321';
const KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const MAIL = 'http://127.0.0.1:54324';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  PASS' : '! FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const api = async (path, { method = 'POST', token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token || KEY}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
};

async function latestCodeFor(email) {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${MAIL}/api/v1/messages?limit=40`);
    const { messages = [] } = await res.json();
    const hit = messages.find((m) => m.To.some((t) => t.Address === email));
    if (hit) {
      const full = await (await fetch(`${MAIL}/api/v1/message/${hit.ID}`)).json();
      const body = full.HTML || full.Text || '';
      const m = body.match(/\b(\d{6})\b/);
      if (m) return { code: m[1], subject: full.Subject };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { code: null, subject: null };
}

const clearMail = () => fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' });

const RUN = Date.now().toString().slice(-6);
const EMAIL = `e2e-${RUN}@example.com`;
const TAG = `Racer${RUN}`;
const PASSWORD = 'correct-horse-8';
const NEW_PASSWORD = 'brand-new-pass-9';

console.log('\n=== 1. Sign up and confirm with the emailed code ===');
await clearMail();

const signup = await api('/auth/v1/signup', {
  body: { email: EMAIL, password: PASSWORD, data: { gamer_tag: TAG } }
});
check('signup accepted', signup.status === 200, `status ${signup.status}`);
check('no session before confirmation', !signup.json?.access_token);

const { code, subject } = await latestCodeFor(EMAIL);
check('6-digit code arrived by email', Boolean(code), `subject "${subject}", code ${code ? 'found' : 'MISSING'}`);

// Settle the SIGNUP_OTP_TYPE question. 'signup' is what the code currently uses.
const verifySignup = await api('/auth/v1/verify', {
  body: { type: 'signup', email: EMAIL, token: code }
});
check("verifyOtp type 'signup' works", verifySignup.status === 200,
  `status ${verifySignup.status} ${verifySignup.json?.msg || ''}`);
const session = verifySignup.json;
check('confirmation returns a session', Boolean(session?.access_token));

console.log('\n=== 2. Sign in with the password ===');
const signin = await api('/auth/v1/token?grant_type=password', {
  body: { email: EMAIL, password: PASSWORD }
});
check('sign in succeeds', signin.status === 200, `status ${signin.status}`);
const token = signin.json?.access_token;

console.log('\n=== 3. Profile is readable, banned_at is not ===');
// Filtered to THIS run's tag. Unfiltered, the first row is whichever profile
// an earlier run happened to leave behind, and the check passes or fails by
// accident. Gamer tags are readable by everyone by design, so a filter here
// tests the grant just as well as a bare select would.
const prof = await api(`/rest/v1/profiles?select=id,gamer_tag,created_at&gamer_tag=eq.${TAG}`,
  { method: 'GET', token });
check('profile readable with named columns', prof.status === 200 && prof.json?.[0]?.gamer_tag === TAG,
  JSON.stringify(prof.json).slice(0, 90));
const profStar = await api('/rest/v1/profiles?select=*', { method: 'GET', token });
check('select(*) still refused when signed in', profStar.json?.code === '42501');

// submit-score answers { row, unlocked } since badges landed. The bare-array
// form is still accepted here for the same reason js/shared/net/leaderboard.js
// accepts it: this suite has to be able to run against a function deploy that
// predates the change without reporting a false failure.
const rowOf = (json) =>
  Array.isArray(json) ? json[0] : (json?.row ?? json?.data ?? json?.record ?? json);
const unlockedOf = (json) => (Array.isArray(json?.unlocked) ? json.unlocked : []);

console.log('\n=== 4. Submit a score from each game as a signed-in player ===');
// Badges unlocked per game, kept so the assertions below can be about the WHOLE
// sequence rather than one call in isolation.
const unlockedByGame = {};
for (const [game, score] of [['tetris', 12000], ['snake', 400], ['breakout', 5000]]) {
  const r = await api('/functions/v1/submit-score', {
    token,
    body: { game_id: game, player_name: 'ZZZ', score, session_duration_seconds: 300 }
  });
  const row = rowOf(r.json);
  const name = row?.player_name ?? JSON.stringify(r.json).slice(0, 80);
  check(`${game}: name comes from the DB, not the request`, name === TAG, `got "${name}"`);
  check(`${game}: row is verified`, row?.is_verified === true);
  unlockedByGame[game] = unlockedOf(r.json);
}

console.log('\n=== 4b. Badges are awarded, once, on the server ===');
// A brand-new account, so the very first accepted score is its first ever.
check('first submission unlocks On the Board',
  unlockedByGame.tetris.includes('first-score'),
  JSON.stringify(unlockedByGame.tetris));
check('On the Board is not awarded twice',
  !unlockedByGame.snake.includes('first-score') && !unlockedByGame.breakout.includes('first-score'),
  `snake ${JSON.stringify(unlockedByGame.snake)} breakout ${JSON.stringify(unlockedByGame.breakout)}`);
// Arcade Tourist needs every game in the catalogue, so it can only land on the
// third one — and it must land there, not on the first or second.
check('Arcade Tourist lands on the third game and not before',
  unlockedByGame.breakout.includes('all-three')
    && !unlockedByGame.tetris.includes('all-three')
    && !unlockedByGame.snake.includes('all-three'),
  JSON.stringify(unlockedByGame));
// 400 clears Snake's bronze (250) and not its silver (550); 5,000 clears all
// three Breakout rungs; 12,000 clears none of Tetris's (bronze is 50,000).
check('snake 400 earns bronze only',
  unlockedByGame.snake.includes('score-snake-1')
    && !unlockedByGame.snake.includes('score-snake-2'),
  JSON.stringify(unlockedByGame.snake));
check('breakout 5000 earns the whole ladder',
  ['score-breakout-1', 'score-breakout-2', 'score-breakout-3']
    .every((k) => unlockedByGame.breakout.includes(k)),
  JSON.stringify(unlockedByGame.breakout));
check('tetris 12000 earns no score badge',
  !unlockedByGame.tetris.some((k) => k.startsWith('score-tetris-')),
  JSON.stringify(unlockedByGame.tetris));

// IDEMPOTENCY. The same run submitted again must award nothing it already
// holds — the primary key on (user_id, achievement_key) plus `on conflict do
// nothing` is what guarantees it, and a double-tapped Save button is the real
// case this protects.
const repeat = await api('/functions/v1/submit-score', {
  token,
  body: { game_id: 'breakout', player_name: 'ZZZ', score: 5000, session_duration_seconds: 300 }
});
const repeatUnlocked = unlockedOf(repeat.json);
check('a repeat submission re-awards nothing',
  repeatUnlocked.every((k) => !unlockedByGame.breakout.includes(k)),
  JSON.stringify(repeatUnlocked));

const userId = prof.json?.[0]?.id;
check('profile id available for the badge checks', Boolean(userId), `got ${userId}`);

// player_achievements is PUBLIC — it renders next to a gamer tag on the board —
// so this read is made SIGNED OUT on purpose.
const badges = await api(
  `/rest/v1/player_achievements?select=achievement_key,earned_at&user_id=eq.${userId}`,
  { method: 'GET' });
check('player_achievements readable while signed out', badges.status === 200,
  JSON.stringify(badges.json).slice(0, 120));
const heldKeys = (badges.json ?? []).map((r) => r.achievement_key);
check('every unlocked key was actually stored',
  Object.values(unlockedByGame).flat().every((k) => heldKeys.includes(k)),
  `stored ${JSON.stringify(heldKeys)}`);
check('stored exactly once each — no duplicate rows',
  heldKeys.length === new Set(heldKeys).size, JSON.stringify(heldKeys));

// select(*) SUCCEEDS here, and that is correct — unlike profiles and
// leaderboard, this table withholds nothing. `*` fails on those two because the
// grant omits a column (banned_at, user_id), not merely because it is
// column-level. What this asserts instead is that the grant is exactly the
// three intended columns: if a private column is ever added without extending
// the revoke/grant pair, it appears here and this fails.
const badgeStar = await api('/rest/v1/player_achievements?select=*', { method: 'GET' });
check('select(*) succeeds on player_achievements — nothing is withheld',
  badgeStar.status === 200, JSON.stringify(badgeStar.json).slice(0, 90));
check('and exposes exactly the three intended columns',
  badgeStar.json?.[0]
    && ['user_id', 'achievement_key', 'earned_at'].every((c) => c in badgeStar.json[0])
    && Object.keys(badgeStar.json[0]).length === 3,
  `got ${JSON.stringify(Object.keys(badgeStar.json?.[0] ?? {}))}`);

// THE PRIVACY BOUNDARY. player_stats and player_days ARE the cross-game history
// that leaderboard.user_id is withheld to prevent assembling, so they must be
// unreachable by anon AND by the signed-in owner — RLS on, no policies, no
// grants. Both are checked with a token, which is the stronger of the two.
for (const table of ['player_stats', 'player_days']) {
  const res = await api(`/rest/v1/${table}?select=user_id`, { method: 'GET', token });
  check(`${table} is unreachable even by its owner`, res.status !== 200,
    `status ${res.status} ${JSON.stringify(res.json).slice(0, 90)}`);
}

console.log('\n=== 5. Anonymous submission still works ===');
const anon = await api('/functions/v1/submit-score', {
  body: { game_id: 'tetris', player_name: 'abc', score: 50, session_duration_seconds: 60 }
});
const anonRow = rowOf(anon.json);
check('anonymous initials accepted and upper-cased', anonRow?.player_name === 'ABC',
  `got "${anonRow?.player_name}"`);
check('anonymous row is NOT verified', anonRow?.is_verified === false);
// Anonymous runs earn nothing: the only key available is a typed-in display
// name, and AAA is shared by strangers, so there is nobody to award to.
check('anonymous submission earns no badges', unlockedOf(anon.json).length === 0,
  JSON.stringify(unlockedOf(anon.json)));

console.log('\n=== 6. Leaderboard shows the tag and the badge ===');
// No `limit` window here either: a top-5 slice stops containing this run's
// score as soon as a previous run leaves a higher one behind.
const board = await api(`/rest/v1/leaderboard?select=player_name,score,is_verified&game_id=eq.tetris&player_name=eq.${TAG}`,
  { method: 'GET' });
check('leaderboard readable while signed out', board.status === 200, JSON.stringify(board.json).slice(0, 120));
check('verified tag is on the board', board.json?.some((r) => r.player_name === TAG && r.is_verified === true));

console.log('\n=== 7. Report a name ===');
// A second, real account to report. Reporting your OWN tag is refused by design,
// so a self-report is not a valid test of the reporting path.
const OTHER_EMAIL = `e2e-other-${RUN}@example.com`;
const OTHER_TAG = `Rival${RUN}`;
await api('/auth/v1/signup', {
  body: { email: OTHER_EMAIL, password: PASSWORD, data: { gamer_tag: OTHER_TAG } }
});
const { code: otherCode } = await latestCodeFor(OTHER_EMAIL);
await api('/auth/v1/verify', { body: { type: 'signup', email: OTHER_EMAIL, token: otherCode } });

const selfReport = await api('/functions/v1/report-name', {
  token, body: { gamer_tag: TAG, reason: 'e2e test' }
});
check('self-report is refused', selfReport.status === 400,
  `status ${selfReport.status}`);

const report = await api('/functions/v1/report-name', {
  token, body: { gamer_tag: OTHER_TAG, reason: 'e2e test' }
});
check('report accepted', report.status === 200, `status ${report.status} ${report.text.slice(0, 90)}`);

const reportUnknown = await api('/functions/v1/report-name', {
  token, body: { gamer_tag: 'NoSuchPlayerHere', reason: 'e2e test' }
});
check('unknown tag answers identically (no enumeration oracle)',
  reportUnknown.status === report.status && reportUnknown.text === report.text,
  `known ${report.status} | unknown ${reportUnknown.status}`);

const dupe = await api('/functions/v1/report-name', {
  token, body: { gamer_tag: OTHER_TAG, reason: 'e2e test again' }
});
check('duplicate report answers identically', dupe.status === 200 && dupe.text === report.text);

console.log('\n=== 8. Password reset with a code ===');
await clearMail();
const recover = await api('/auth/v1/recover', { body: { email: EMAIL } });
check('reset email requested', recover.status === 200, `status ${recover.status}`);
const { code: resetCode, subject: resetSubject } = await latestCodeFor(EMAIL);
check('reset code arrived', Boolean(resetCode), `subject "${resetSubject}"`);
const verifyRecovery = await api('/auth/v1/verify', {
  body: { type: 'recovery', email: EMAIL, token: resetCode }
});
check('recovery code verifies', verifyRecovery.status === 200, `status ${verifyRecovery.status}`);
const recoveryToken = verifyRecovery.json?.access_token;
const updated = await api('/auth/v1/user', {
  method: 'PUT', token: recoveryToken, body: { password: NEW_PASSWORD }
});
check('password updated', updated.status === 200, `status ${updated.status}`);
const reSignin = await api('/auth/v1/token?grant_type=password', {
  body: { email: EMAIL, password: NEW_PASSWORD }
});
check('sign in with the NEW password', reSignin.status === 200);
const oldSignin = await api('/auth/v1/token?grant_type=password', {
  body: { email: EMAIL, password: PASSWORD }
});
check('old password no longer works', oldSignin.status !== 200, `status ${oldSignin.status}`);

console.log('\n=== 9. Delete the account; scores survive but lose the badge ===');
const finalToken = reSignin.json?.access_token;
const del = await api('/functions/v1/delete-account', { token: finalToken });
check('delete-account accepted', del.status === 200, `status ${del.status} ${del.text.slice(0, 80)}`);

await new Promise((r) => setTimeout(r, 600));
const after = await api(`/rest/v1/leaderboard?select=player_name,score,is_verified&player_name=eq.${TAG}`,
  { method: 'GET' });
check('scores survive the deletion', (after.json?.length ?? 0) === 4, `${after.json?.length} rows`);
check('every surviving row flipped to unverified',
  after.json?.every((r) => r.is_verified === false),
  JSON.stringify(after.json));

// BADGES DO NOT SURVIVE, and the asymmetry with the scores above is the design.
// leaderboard.user_id is ON DELETE SET NULL because deleting an account must
// not silently rewrite the public board; player_achievements is ON DELETE
// CASCADE because a badge belongs to nobody once the account is gone, and rows
// keyed by a dead uuid would be a leak with no upside.
const badgesAfter = await api(
  `/rest/v1/player_achievements?select=achievement_key&user_id=eq.${userId}`,
  { method: 'GET' });
check('badges are cascaded away with the account',
  badgesAfter.status === 200 && (badgesAfter.json?.length ?? -1) === 0,
  `status ${badgesAfter.status}, ${badgesAfter.json?.length} rows left`);

console.log(`\n${'='.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(46)}\n`);
process.exit(fail ? 1 : 0);
