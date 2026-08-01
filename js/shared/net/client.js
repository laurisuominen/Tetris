/**
 * The one Supabase client for the whole site.
 *
 * This file exists to make a second `createClient` call impossible, because two
 * clients is not "one more object" — it is two independent auth states. Each
 * client builds its own auth store and its own token-refresh timer over the same
 * storage key, and only the instance that performed `signIn` holds the live
 * session in memory. So a page that created one client for `auth.js` and another
 * for `leaderboard.js` would sign the player in through the first and then submit
 * their score through the second, which has no session and therefore attaches no
 * Authorization header. The score posts, the server sees an anonymous request,
 * and the player's verified name never lands on the row. Nothing errors; the
 * score is simply anonymous. That is the bug this module prevents, and it is why
 * both `auth.js` and `leaderboard.js` import the instance from here rather than
 * making their own.
 *
 * (The same duplication is what makes supabase-js log "Multiple GoTrueClient
 * instances detected in the same browser context" — the warning is about
 * exactly this: undefined behaviour when two clients race on one session.)
 *
 * The SDK itself is NOT imported. Every page that needs the network loads it as
 * a classic <script> from jsDelivr, which puts it on `window.supabase`. Keeping
 * it off the module graph is what lets the hub — and any page that only needs
 * the local, cached display state in `js/shared/account/session.js` — keep a
 * `default-src 'self'` CSP with no CDN and no `connect-src` at all.
 */

const PRODUCTION_URL = 'https://obkndxwkpodmcqumocfi.supabase.co';

/*
 * Publishable (anon) key. Safe in client source by design — it is a public
 * identifier, and RLS plus the Edge Functions are the actual gate. A
 * service-role key must never appear in this directory or any other client file.
 */
const PRODUCTION_KEY = 'sb_publishable_NkoT-M7MMf5VAKLGPcLOQg_sGznD-bF';

/*
 * The `supabase start` stack, for local development only.
 *
 * This key is NOT a secret and is not this project's. The CLI derives it from
 * the fixed local JWT secret ("super-secret-jwt-token-with-at-least-32-
 * characters-long"), so every developer running `supabase start` gets the same
 * one and it authenticates against nothing but 127.0.0.1. Committing it is
 * fine; mistaking it for a production credential is not.
 *
 * A publishable key rather than the legacy `ANON_KEY` JWT that `supabase start`
 * also prints, and the difference matters for what gets tested: submit-score
 * shape-checks the Authorization header and only calls `auth.getUser` when it
 * looks like a JWT. Wiring the legacy key here would send the anon key down a
 * code path production never takes, so local would stop exercising the branch
 * that actually runs.
 */
const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

/*
 * Loopback means local backend. Same test as js/shared/pwa.js uses to skip
 * service-worker registration, and for the same reason: a dev server is not the
 * deployed site and should not be talking to the deployed site's database.
 *
 * Hostname, not port — the site is served by `python3 -m http.server 8000` but
 * nothing guarantees that port, and a file:// page has no hostname at all and
 * correctly falls through to production.
 */
const isLoopback =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname === '[::1]';

const SUPABASE_URL = isLoopback ? LOCAL_URL : PRODUCTION_URL;
const SUPABASE_ANON_KEY = isLoopback ? LOCAL_KEY : PRODUCTION_KEY;

/*
 * Fail loudly and by name. Previously a page that forgot the CDN <script> tag
 * (or whose CSP silently blocked it) died on `window.supabase.createClient` with
 * "Cannot read properties of undefined (reading 'createClient')" — a message
 * that names neither the cause nor the fix. This throws at module evaluation,
 * before any UI has had a chance to render a half-working screen.
 */
if (!window.supabase || typeof window.supabase.createClient !== 'function') {
  throw new Error(
    'Supabase SDK not found on window.supabase. Any page importing js/shared/net/ ' +
    'must load <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> ' +
    'BEFORE its <script type="module">, and its CSP must allow cdn.jsdelivr.net in ' +
    'script-src plus ' + SUPABASE_URL + ' in connect-src.'
  );
}

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
