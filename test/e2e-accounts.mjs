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
 * generated `is_verified` column recomputing on account deletion, and the
 * 6-digit code actually arriving. Those were reviewed-not-verified for the
 * whole of the accounts work.
 *
 *   supabase start
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

console.log('\n=== 4. Submit a score from each game as a signed-in player ===');
for (const [game, score] of [['tetris', 12000], ['snake', 400], ['breakout', 5000]]) {
  const r = await api('/functions/v1/submit-score', {
    token,
    body: { game_id: game, player_name: 'ZZZ', score, session_duration_seconds: 300 }
  });
  const row = Array.isArray(r.json) ? r.json[0] : (r.json?.data ?? r.json?.record ?? r.json);
  const name = row?.player_name ?? JSON.stringify(r.json).slice(0, 80);
  check(`${game}: name comes from the DB, not the request`, name === TAG, `got "${name}"`);
  check(`${game}: row is verified`, row?.is_verified === true);
}

console.log('\n=== 5. Anonymous submission still works ===');
const anon = await api('/functions/v1/submit-score', {
  body: { game_id: 'tetris', player_name: 'abc', score: 50, session_duration_seconds: 60 }
});
const anonRow = Array.isArray(anon.json) ? anon.json[0] : (anon.json?.data ?? anon.json?.record ?? anon.json);
check('anonymous initials accepted and upper-cased', anonRow?.player_name === 'ABC',
  `got "${anonRow?.player_name}"`);
check('anonymous row is NOT verified', anonRow?.is_verified === false);

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
check('scores survive the deletion', (after.json?.length ?? 0) === 3, `${after.json?.length} rows`);
check('every surviving row flipped to unverified',
  after.json?.every((r) => r.is_verified === false),
  JSON.stringify(after.json));

console.log(`\n${'='.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(46)}\n`);
process.exit(fail ? 1 : 0);
