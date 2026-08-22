/**
 * Arcade-wide mute.
 *
 * `createMuteState` and `withMute` both take their storage / settings source as
 * an argument, so this file needs no `window` and no localStorage stand-in —
 * unlike scoresStore.test.js, which has to install one. That is the whole
 * reason the module is shaped this way.
 *
 * The cases worth pinning are the ones a hand-check would miss:
 *
 *  - Unmuting must restore the player's ORIGINAL volume. This is the bug the
 *    design exists to avoid, and the reason mute is not "write 0 into volume".
 *  - A junk stored value must read as unmuted. Silence is the failure mode a
 *    player cannot diagnose.
 *  - `withMute` must not allocate a new object per call. Every sfx module calls
 *    its getter on every dot eaten and every shot fired.
 */

import { describe, it, expect } from './harness.js';
import { createMuteState, withMute } from '../js/shared/audio/mute.js';

/** A storage stand-in that also records what was written. */
function fakeStorage(initial) {
  const writes = [];
  let value = initial;
  return {
    writes,
    read: () => value,
    write: (next) => { value = next; writes.push(next); }
  };
}

describe('createMuteState', () => {
  it('defaults to unmuted when nothing is stored', () => {
    expect(createMuteState(fakeStorage(undefined)).isMuted()).toBe(false);
  });

  it('reads a stored true as muted', () => {
    expect(createMuteState(fakeStorage(true)).isMuted()).toBe(true);
  });

  it('treats a corrupt stored value as unmuted rather than muted', () => {
    // Anything that is not literally `true`. A player who cannot hear the game
    // and cannot see why has no way out; the reverse is merely loud.
    for (const junk of ['true', 1, 0, null, {}, [], 'yes']) {
      expect(createMuteState(fakeStorage(junk)).isMuted()).toBe(false);
    }
  });

  it('toggles and persists', () => {
    const storage = fakeStorage(false);
    const state = createMuteState(storage);
    expect(state.toggle()).toBe(true);
    expect(state.isMuted()).toBe(true);
    expect(storage.writes).toEqual([true]);
    expect(state.toggle()).toBe(false);
    expect(storage.writes).toEqual([true, false]);
  });

  it('does not write or notify when the value is unchanged', () => {
    const storage = fakeStorage(false);
    const state = createMuteState(storage);
    let calls = 0;
    state.subscribe(() => { calls += 1; });
    state.setMuted(false);
    expect(storage.writes).toEqual([]);
    expect(calls).toBe(0);
  });

  it('notifies every subscriber, and stops after unsubscribe', () => {
    const state = createMuteState(fakeStorage(false));
    const seen = [];
    const off = state.subscribe((muted) => seen.push(muted));
    state.subscribe((muted) => seen.push(`b:${muted}`));
    state.toggle();
    expect(seen).toEqual([true, 'b:true']);
    off();
    state.toggle();
    expect(seen).toEqual([true, 'b:true', 'b:false']);
  });
});

describe('withMute', () => {
  it('passes settings straight through when unmuted', () => {
    const settings = { volume: 0.7, haptics: true };
    const state = createMuteState(fakeStorage(false));
    // Same object identity, not just an equal one — no copy is made on the
    // common path.
    expect(withMute(() => settings, state)()).toBe(settings);
  });

  it('reports volume 0 while muted and preserves every other field', () => {
    const settings = { volume: 0.7, haptics: true, modernAI: false };
    const state = createMuteState(fakeStorage(true));
    const get = withMute(() => settings, state);
    expect(get().volume).toBe(0);
    expect(get().haptics).toBe(true);
    expect(get().modernAI).toBe(false);
  });

  it('restores the original volume on unmute', () => {
    // The reason this module exists. Mute must not be destructive.
    const settings = { volume: 0.3 };
    const state = createMuteState(fakeStorage(false));
    const get = withMute(() => settings, state);

    expect(get().volume).toBe(0.3);
    state.toggle();
    expect(get().volume).toBe(0);
    state.toggle();
    expect(get().volume).toBe(0.3);
    // The source object was never written to.
    expect(settings.volume).toBe(0.3);
  });

  it('does not allocate a new object per call while muted', () => {
    const settings = { volume: 0.5 };
    const state = createMuteState(fakeStorage(true));
    const get = withMute(() => settings, state);
    expect(get()).toBe(get());
  });

  it('picks up a volume change made while muted', () => {
    // The settings UI replaces its object wholesale on Save, so identity is
    // the signal that the cached zeroed copy is stale.
    let settings = { volume: 0.5 };
    const state = createMuteState(fakeStorage(true));
    const get = withMute(() => settings, state);

    expect(get().volume).toBe(0);
    settings = { volume: 0.9 };
    expect(get().volume).toBe(0);
    state.toggle();
    expect(get().volume).toBe(0.9);
  });
});
