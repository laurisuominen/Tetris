/**
 * Cached display name for the signed-in player. NO network, NO Supabase.
 *
 * ADVISORY DISPLAY STATE ONLY. Nothing here is evidence that anyone is signed
 * in. It is a string in localStorage, so it is writable by the player, by an
 * extension, or by any script that ever ran on this origin. Never gate anything
 * on it: not a submission, not an unlock, not a "verified" badge. The server
 * re-derives identity from the JWT on every request, and that is the only check
 * that decides who a score belongs to. The worst a forged value here can do is
 * make the hub greet someone by the wrong name.
 *
 * Why cache at all, rather than asking auth.js? Because asking requires the
 * Supabase SDK, and the SDK is a jsDelivr <script> tag. The hub ships
 * `default-src 'self'` with no CDN and no connect-src — deliberately, since it
 * is a static picker that must paint instantly and work offline from the service
 * worker cache. Reading a name out of localStorage keeps that CSP intact and
 * keeps the greeting working with no network at all. Game pages get the same
 * benefit: the HUD can say who you are before, or without, the SDK loading.
 *
 * Kept in js/shared/account/ rather than js/shared/net/ precisely because it is
 * not network code. The invariant "no fetch or Supabase import outside
 * js/shared/net/" holds here trivially — this file imports storage and nothing
 * else, and it must stay that way.
 */

import { getItem, setItem } from '../storage/storage.js';

const KEY = 'account_profile_v1';

/*
 * Display clamp, not a validation rule. The canonical gamer-tag rules live in
 * the validator and, authoritatively, on the server. This exists so a hostile or
 * corrupt blob holding a 50,000-character "tag" cannot blow out the hub layout
 * or the game HUD. A tag that legitimately exceeds this would be a bug in the
 * validator, not something to render.
 */
const MAX_TAG_LENGTH = 32;

/**
 * @returns {{gamerTag: string}|null} null when absent, malformed or hostile.
 */
export function getCachedProfile() {
  const loaded = getItem(KEY, null);

  // Validate on read, the way settingsStore does: this value crosses a trust
  // boundary (disk -> DOM) and callers pass it straight to setText.
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) return null;
  if (typeof loaded.gamerTag !== 'string') return null;

  const gamerTag = loaded.gamerTag.slice(0, MAX_TAG_LENGTH);
  if (gamerTag === '') return null;

  // Rebuilt rather than spread, so an old or tampered blob cannot smuggle extra
  // fields (a stale `is_verified`, say) into code that then trusts them.
  return { gamerTag };
}

/**
 * Stores the tag for display. Rejects anything unusable rather than persisting
 * a value that getCachedProfile would then refuse to read back.
 */
export function setCachedProfile(profile) {
  if (!profile || typeof profile.gamerTag !== 'string' || profile.gamerTag === '') {
    throw new Error('setCachedProfile requires a profile with a non-empty gamerTag');
  }

  setItem(KEY, { gamerTag: profile.gamerTag.slice(0, MAX_TAG_LENGTH) });
}

/**
 * Call this on sign-out and on account deletion — auth.js deliberately does not,
 * so that net/ never touches display state.
 *
 * Writes null instead of removing the key: storage.js exposes only getItem and
 * setItem, and widening that shared module for one caller is a bigger change
 * than this needs. A stored `null` reads back through getItem as null and is
 * rejected by the guard above, so it is indistinguishable from absent.
 */
export function clearCachedProfile() {
  setItem(KEY, null);
}
