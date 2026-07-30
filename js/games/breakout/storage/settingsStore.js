import { getItem, setItem } from '../../../shared/storage/storage.js';
import { SPEEDS } from '../core/constants.js';

const KEY = 'breakout_settings_v1';

export const DEFAULT_SETTINGS = Object.freeze({
  motion: 'auto',
  volume: 0.5,
  haptics: true,
  /** Pointer control on the board. Off leaves the keyboard and arrows. */
  pointerControls: true,
  speed: SPEEDS.CLASSIC
});

const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

export function loadSettings() {
  const loaded = getItem(KEY, {});
  // Validate and clamp types so a bad or hostile blob can't break the game.
  // speed in particular reaches the core, where an unknown tier throws.
  return {
    motion: ['auto', 'off'].includes(loaded.motion) ? loaded.motion : DEFAULT_SETTINGS.motion,
    volume: typeof loaded.volume === 'number' && loaded.volume >= 0 && loaded.volume <= 1
      ? loaded.volume : DEFAULT_SETTINGS.volume,
    haptics: bool(loaded.haptics, DEFAULT_SETTINGS.haptics),
    pointerControls: bool(loaded.pointerControls, DEFAULT_SETTINGS.pointerControls),
    speed: Object.hasOwn(SPEEDS, loaded.speed) ? loaded.speed : DEFAULT_SETTINGS.speed
  };
}

export function saveSettings(settings) {
  setItem(KEY, settings);
}
