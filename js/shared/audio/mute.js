/**
 * Arcade-wide audio mute.
 *
 * This is deliberately NOT the same thing as each game's `volume` slider, and
 * the split is the design:
 *
 *   - Volume is per game and answers "how loud is this one".
 *   - Mute is one switch across the whole arcade and answers "any sound at all".
 *
 * Keeping them separate is what lets unmuting restore the exact volume the
 * player chose. Implementing mute as "write 0 into volume" would destroy that
 * number, so the slider would come back at zero and the player would have to
 * find their level again — a toggle that is not a toggle.
 *
 * The state is ONE localStorage key shared by every game, because a player who
 * mutes Tetris and then opens Snake means "off", not "off here". That is also
 * why it lives in js/shared/ rather than in five settings stores: five copies of
 * one switch is the same shape as the badge-shelf bug in CLAUDE.md — a list in
 * one module that has to track a list in another, with nothing enforcing it.
 *
 * Cross-TAB sync is not implemented. Two game tabs open at once would each keep
 * their own in-memory copy until reload. A `storage` event listener would fix
 * it; it is left out because nothing here needs a `window`, which is what keeps
 * this module testable under Node.
 */

import { getItem, setItem } from '../storage/storage.js';

export const MUTE_KEY = 'arcade_muted_v1';

/**
 * Storage is injected rather than imported — the house pattern, and the reason
 * this has real coverage without a DOM.
 *
 * @param {{ read: () => unknown, write: (value: boolean) => void }} storage
 */
export function createMuteState({ read, write }) {
  // A corrupt, absent or hand-edited value must never brick audio, so anything
  // that is not literally `true` is unmuted. Silence is the failure mode a
  // player cannot diagnose; noise is one they can.
  let muted = read() === true;
  const listeners = new Set();

  function setMuted(next) {
    const value = next === true;
    // No write and no notify on a no-op, so a button that repaints on every
    // change does not repaint on every click that changes nothing.
    if (value === muted) return muted;
    muted = value;
    write(muted);
    for (const listener of listeners) listener(muted);
    return muted;
  }

  return {
    isMuted: () => muted,
    setMuted,
    toggle: () => setMuted(!muted),
    /** @returns {() => void} unsubscribe */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

/** The one instance every game shares. */
export const mute = createMuteState({
  read: () => getItem(MUTE_KEY, false),
  write: (value) => setItem(MUTE_KEY, value)
});

/**
 * Wraps a settings getter so that, while muted, its consumer sees `volume: 0`.
 *
 * This is how mute reaches the sound layer without any game's audio module
 * knowing mute exists. Every sfx module already opens with
 * `const getVolume = () => getSettings().volume` and returns early at zero, so
 * zero IS the whole implementation — no edit to any of the five.
 *
 * The zeroed object is rebuilt only when the underlying settings object changes
 * identity, not per call. These getters run on every dot eaten and every shot
 * fired, and CLAUDE.md's rule against allocating in the loop applies.
 */
export function withMute(getSettings, state = mute) {
  let source = null;
  let silent = null;
  return () => {
    const settings = getSettings();
    if (!state.isMuted()) return settings;
    if (settings !== source) {
      source = settings;
      // Spread rather than a bare `{ volume: 0 }`: a caller that reads any
      // other field still gets the player's real value.
      silent = { ...settings, volume: 0 };
    }
    return silent;
  };
}
