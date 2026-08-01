# Dashboard settings the repo cannot hold

`supabase/config.toml` configures `supabase start` and **nothing else**. The
production project reads none of it. Everything below lives in the Supabase
dashboard, is invisible to code review, and is not reproduced by `db reset` —
which is precisely why it is written down here.

Project: `obkndxwkpodmcqumocfi` (Tetris-leaderboard).

---

## 1. The auth hook — DO THIS FIRST

**Until this is registered, gamer tags are not validated on production.**

The Edge Function is deployed, but a hook that is not registered is simply never
called. `handle_new_user()` still creates the profile from whatever
`raw_user_meta_data.gamer_tag` the client sent, so a signup with a profane or
already-taken tag currently succeeds. The account page's own check is
shape-only and is bypassable by POSTing to `/auth/v1/signup` directly — that is
the whole reason the hook exists.

1. Generate a secret. Any 32 random bytes, base64, prefixed:
   `v1,whsec_<base64>` — e.g. `openssl rand -base64 32`.
2. **Authentication → Hooks → Before User Created**
   - Enable it.
   - Type: HTTPS.
   - URL: `https://obkndxwkpodmcqumocfi.supabase.co/functions/v1/before-user-created`
   - Secret: the value from step 1.
3. **Edge Functions → before-user-created → Settings → Secrets**: add
   `BEFORE_USER_CREATED_HOOK_SECRET` with the *same* value.
4. **Edge Functions → before-user-created → Details**: confirm **Verify JWT is
   OFF**. Supabase Auth calls this server-to-server with no user JWT; with
   verification on, the platform rejects the call before the function runs and
   every signup fails. The StandardWebhooks signature is what authenticates the
   caller instead, and it covers the body rather than just the connection.

Both values must match. The function **fails closed**: a missing or wrong secret
refuses every signup with "Sign-up is temporarily unavailable." That is
deliberate — the alternative is an unauthenticated endpoint that nobody notices.

Verify: try to sign up with the gamer tag `FuckFace`. It must be refused with
"That gamer tag is not allowed." If it is *accepted*, the hook is not wired up.

## 2. Custom SMTP — signup does not work without it

The built-in mailer sends **2 messages an hour and only to addresses on the
project team**. It cannot serve real players. This is a hard blocker, not a rate
limit to live with.

1. Create a Resend account (free tier: 3,000/month, 100/day, one domain) and
   verify the sending domain via its DNS records.
2. **Project Settings → Authentication → SMTP Settings**: enable custom SMTP and
   enter the host, port, username and API key, plus the sender address and name.

Custom SMTP is also what unlocks step 3: free projects created after 2026-06-03
cannot edit auth email templates on the default mailer.

## 3. Both email templates must send the CODE, not a link

**Authentication → Emails → Templates.** In *Confirm signup* and *Reset
password*, replace `{{ .ConfirmationURL }}` with `{{ .Token }}`.

The account pages ask the player to type a 6-digit code. If either template
still sends a link, that flow is broken for every user regardless of what the
code does — `confirmSignUpCode()` and `confirmPasswordReset()` have nothing to
verify.

`supabase/templates/confirm.html` and `recovery.html` are the local mirrors.
They are a copy for `supabase start`; editing them does not change production.
Keep the two in step by hand.

## 4. Confirm email, and the Site URL

- **Authentication → Sign In / Providers → Email**: "Confirm email" **ON**. With
  it off, an unconfirmed account can immediately claim a gamer tag and post
  scores.
- **Authentication → URL Configuration → Site URL**: `https://aihealgenius.com`.

---

## What is already done

Applied 2026-08-01, verified against the live project:

- `20260731000000_accounts.sql` applied. All 194 leaderboard rows intact,
  `is_verified` present and false on every existing row.
- Column-level grants confirmed live: `select('*')` → 42501 on `leaderboard` and
  `profiles`, `user_id` and `banned_at` unreadable, `name_reports` unreachable.
- `submit-score`, `before-user-created`, `report-name` and `delete-account`
  deployed. Anonymous score submission re-tested and working; the prune trigger
  fired correctly on the test row.

## Still open, and not a dashboard setting

`ALLOW_ANY_ORIGIN` in `supabase/functions/_shared/cors.ts` is still `true`, so
the deployed functions answer `Access-Control-Allow-Origin: *`. CLAUDE.md wants
real origins in production. It is a one-line flip plus a redeploy; the allow-list
is already written.
