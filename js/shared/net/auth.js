/**
 * Account operations against Supabase Auth.
 *
 * Two conventions, both inherited from leaderboard.js:
 *
 * 1. THROW, don't swallow. Supabase returns `{ data, error }` rather than
 *    rejecting, so an unchecked call reads as success and returns undefined
 *    fields. That is the failure mode that once rendered "No global scores yet"
 *    over a full table; here the equivalent would be a sign-in form that clears
 *    itself and leaves the player signed out with no explanation. Every function
 *    below re-throws so the caller is forced to render a failure state.
 *
 * 2. Return plain values, not Supabase envelopes. Callers get a session, a
 *    profile row or a small result object — never `{ data, error }`. This is the
 *    only module allowed to know the SDK's shape, and keeping the envelope here
 *    is what makes it swappable.
 *
 * Required arguments throw rather than defaulting, matching requireGameId and
 * createScoresStore: a missing email silently becomes a request for the empty
 * string, which the API rejects with a message about the wrong thing entirely.
 *
 * This module does NO display state. It never writes the localStorage cache in
 * js/shared/account/session.js — the UI layer owns that, so that `net/` stays
 * network-only and `account/` stays offline-only. Callers of signOut() and
 * deleteAccount() must call clearCachedProfile() themselves.
 */

import { supabase } from './client.js';

/**
 * UNVERIFIED AGAINST THE LIVE API — must be confirmed by hand before release.
 *
 * Supabase's own material is genuinely inconsistent here. The `EmailOtpType`
 * union in auth-js was originally 'signup' | 'invite' | 'magiclink' |
 * 'recovery' | 'email_change'; 'email' was added later for the current API
 * behaviour, and the reference page's own verifyOtp examples use 'email' while
 * neighbouring signup material uses 'signup'. There are open issues on auth-js
 * about exactly this overlap (#437 "merge verifyOtp() email types into one",
 * #679). Reports that 'signup' is deprecated-but-accepted are not something this
 * comment can confirm.
 *
 * So: do not treat this constant as settled. Run one real signup against the
 * project, confirm which value the 6-digit code accepts, and replace this
 * comment with the measured result and the date.
 */
const SIGNUP_OTP_TYPE = 'signup';

/**
 * UNVERIFIED, and it also depends on project CONFIGURATION, not just code.
 *
 * The documented password-reset flow is a link: resetPasswordForEmail sends a
 * magic link, the app listens for the PASSWORD_RECOVERY auth event, then calls
 * updateUser({ password }). The code-based flow used below — verify a 6-digit
 * token, then updateUser — only works if the "Reset Password" email template is
 * changed to emit {{ .Token }} instead of {{ .ConfirmationURL }}. If the
 * template still sends a link, confirmPasswordReset() will fail for every user
 * no matter what this constant says. Verify the template and the type together.
 */
const RECOVERY_OTP_TYPE = 'recovery';

function requireString(value, name, fnName) {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${fnName} requires a non-empty ${name}`);
  }
}

/**
 * Creates the account and mails a confirmation code.
 *
 * The gamer tag rides along in `options.data`, which lands in the auth user's
 * `raw_user_meta_data`. That is not decoration: a Postgres trigger reads
 * `raw_user_meta_data.gamer_tag` to create the profiles row, and an auth hook
 * reads it too. Passing it any other way (a separate insert after signup) would
 * leave a window where a confirmed user has no profile.
 *
 * The returned `possiblyExisting` flag is the interesting part. When the email
 * already has an account, Supabase does NOT return an error — it returns a
 * success with an obfuscated user object whose `identities` array is EMPTY. That
 * is deliberate anti-enumeration: an attacker must not be able to use the signup
 * form to discover which addresses are registered. The cost is that the honest
 * user gets a confirmation email they will never receive (nothing was created)
 * and a screen saying "check your inbox". Surfacing the flag lets the UI word it
 * truthfully — "if this address is new, a code is on its way; if it already has
 * an account, sign in or reset your password instead" — without confirming
 * either way. Do NOT render it as "that email is taken"; that reinstates exactly
 * the enumeration oracle the empty array exists to close.
 *
 * UNVERIFIED: the empty-identities signal is behaviour, not a documented
 * contract, and it only holds while "Confirm email" is ON for the project. With
 * confirmations off, a duplicate signup returns a plain error instead. Confirm
 * both the project setting and the observed shape by hand.
 *
 * @returns {Promise<{user: object|null, session: object|null,
 *                    needsConfirmation: boolean, possiblyExisting: boolean}>}
 */
export async function signUp(email, password, gamerTag) {
  requireString(email, 'email', 'signUp');
  requireString(password, 'password', 'signUp');
  requireString(gamerTag, 'gamerTag', 'signUp');

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { gamer_tag: gamerTag } }
  });

  if (error) {
    console.error('Error signing up:', error);
    throw error;
  }

  const identities = data.user && data.user.identities;
  const possiblyExisting = Array.isArray(identities) && identities.length === 0;

  return {
    user: data.user ?? null,
    session: data.session ?? null,
    // No session means the account is not usable until the code is entered.
    needsConfirmation: !data.session,
    possiblyExisting
  };
}

/**
 * Exchanges the emailed 6-digit code for a session.
 *
 * The parameter is `token` on the wire even though the UI calls it a code; see
 * SIGNUP_OTP_TYPE above for why `type` is not yet trustworthy.
 *
 * @returns {Promise<object|null>} the new session
 */
export async function confirmSignUpCode(email, code) {
  requireString(email, 'email', 'confirmSignUpCode');
  requireString(code, 'code', 'confirmSignUpCode');

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: SIGNUP_OTP_TYPE
  });

  if (error) {
    console.error('Error confirming sign-up code:', error);
    throw error;
  }

  return data.session ?? null;
}

/**
 * Signs in with EMAIL and password.
 *
 * Deliberately not gamer-tag login. A tag is not a credential Supabase knows
 * about, so "sign in as LAURI" would need a server-side tag -> email lookup
 * before the password is ever checked — a new Edge Function, and one that
 * doubles as an oracle telling anyone which tags exist. We are not building it.
 * If it is ever wanted, it belongs behind rate limiting and must return the same
 * response for "no such tag" and "wrong password".
 *
 * @returns {Promise<object|null>} the new session
 */
export async function signIn(email, password) {
  requireString(email, 'email', 'signIn');
  requireString(password, 'password', 'signIn');

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.error('Error signing in:', error);
    throw error;
  }

  return data.session ?? null;
}

/**
 * Ends the session. Callers must also clear the display cache — see the module
 * comment; this module does not touch localStorage display state.
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error('Error signing out:', error);
    throw error;
  }
}

/**
 * The current session, or null.
 *
 * This reads local storage and refreshes the token if needed; it does NOT ask
 * the server whether the user still exists. Treat the result as "this browser
 * holds a token", never as proof of identity — the server re-derives the user
 * from the JWT on every request, and that is the only check that counts.
 *
 * @returns {Promise<object|null>}
 */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error('Error reading session:', error);
    throw error;
  }

  return data.session ?? null;
}

/**
 * The signed-in user's own profiles row, or null when signed out.
 *
 * Selects `*` on purpose. The accounts migration that creates `profiles` is not
 * in supabase/migrations/ yet, so any explicit column list written here would be
 * a guess — and a wrong column name is Postgres 42703, which throws and takes
 * the whole account screen down. `*` is correct under every version of that
 * migration. RLS is what scopes the row to its owner, not the column list.
 * Tighten this to an explicit list once the schema lands and is reviewable.
 *
 * maybeSingle() rather than single(): single() errors when it finds zero rows,
 * and zero rows is a state that genuinely happens — between the auth user being
 * created and the trigger inserting the profile, or permanently if that trigger
 * ever failed. "No profile" should render as a prompt to finish setup, not as a
 * thrown error.
 *
 * @returns {Promise<object|null>}
 */
export async function getProfile() {
  const session = await getSession();
  if (!session) return null;

  // Columns are named explicitly, and must be. The accounts migration replaced
  // the blanket table grant with column-level grants, and Postgres expands
  // `*` to every column and checks privilege on all of them — so `select('*')`
  // here would fail with 42501 rather than quietly omitting banned_at.
  const { data, error } = await supabase
    .from('profiles')
    .select('id, gamer_tag, created_at')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) {
    console.error('Error fetching profile:', error);
    throw error;
  }

  return data ?? null;
}

/**
 * Mails a password-reset code. See RECOVERY_OTP_TYPE: this only produces a CODE
 * if the project's reset template has been switched to {{ .Token }}. Resolves
 * whether or not the address exists — Supabase does not distinguish, again to
 * avoid account enumeration, so the UI must say "if that address has an account,
 * a code is on its way" rather than "check your inbox".
 */
export async function requestPasswordReset(email) {
  requireString(email, 'email', 'requestPasswordReset');

  const { error } = await supabase.auth.resetPasswordForEmail(email);

  if (error) {
    console.error('Error requesting password reset:', error);
    throw error;
  }
}

/**
 * Verifies the reset code and sets the new password.
 *
 * Two steps, in this order and not collapsible: verifyOtp is what establishes
 * the recovery session, and updateUser only works because that session now
 * exists. If the first call succeeds and the second fails, the user is left
 * SIGNED IN with their old password — so the caller must report failure clearly
 * rather than bouncing them to a screen that looks like success.
 *
 * @returns {Promise<object|null>} the session established by the reset
 */
export async function confirmPasswordReset(email, code, newPassword) {
  requireString(email, 'email', 'confirmPasswordReset');
  requireString(code, 'code', 'confirmPasswordReset');
  requireString(newPassword, 'newPassword', 'confirmPasswordReset');

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: RECOVERY_OTP_TYPE
  });

  if (error) {
    console.error('Error verifying password-reset code:', error);
    throw error;
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

  if (updateError) {
    console.error('Error setting new password:', updateError);
    throw updateError;
  }

  return data.session ?? null;
}

/**
 * Deletes the account, via an Edge Function.
 *
 * A client cannot delete its own auth user — that needs the service role, which
 * exists only inside the function. Note there is no user id in the body, and
 * there must never be one: functions.invoke attaches the caller's JWT, and the
 * function derives the user from it. Accepting an id from the client would be a
 * "delete any account you can name" endpoint.
 *
 * Callers must sign out and clear the cached profile afterwards; the local
 * session survives this call and is now a token for a user that no longer exists.
 */
export async function deleteAccount() {
  const { data, error } = await supabase.functions.invoke('delete-account');

  if (error) {
    console.error('Error deleting account:', error);
    throw error;
  }

  return data;
}

/**
 * Subscribes to sign-in/sign-out/token-refresh events.
 *
 * Returns an unsubscribe function rather than the SDK's subscription object, so
 * callers can hand it straight to a teardown path without knowing the shape.
 *
 * Keep `handler` synchronous and cheap. The SDK invokes these callbacks while
 * holding its internal auth lock, so awaiting another supabase call from inside
 * one can deadlock — the usual advice is to defer such work (queueMicrotask or
 * setTimeout 0) instead of awaiting in place. UNVERIFIED here beyond that
 * general guidance; treat it as a reason to keep handlers small rather than as a
 * precise rule.
 *
 * @returns {() => void} unsubscribe
 */
export function onAuthChange(handler) {
  if (typeof handler !== 'function') {
    throw new Error('onAuthChange requires a handler function');
  }

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    handler(event, session);
  });

  return () => data.subscription.unsubscribe();
}
