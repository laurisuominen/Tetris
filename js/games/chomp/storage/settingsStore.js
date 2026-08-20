import { getItem, setItem } from '../../../shared/storage/storage.js';
import { SPEEDS } from '../core/constants.js';

const KEY = 'chomp_settings_v1';

export const DEFAULT_SETTINGS = Object.freeze({
  motion: 'auto',
  volume: 0.5,
  haptics: true,
  /**
   * Corrected ghost targeting. OFF by default, because the arcade's overflow
   * bugs are what the classic patterns are built on. See core/targeting.js.
   */
  modernAI: false,
  speed: SPEEDS.CLASSIC
});

const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

export function loadSettings() {
  const loaded = getItem(KEY, {});
  return {
    motion: ['auto', 'off'].includes(loaded.motion) ? loaded.motion : DEFAULT_SETTINGS.motion,
    volume: typeof loaded.volume === 'number' && loaded.volume >= 0 && loaded.volume <= 1
      ? loaded.volume : DEFAULT_SETTINGS.volume,
    haptics: bool(loaded.haptics, DEFAULT_SETTINGS.haptics),
    modernAI: bool(loaded.modernAI, DEFAULT_SETTINGS.modernAI),
    speed: Object.hasOwn(SPEEDS, loaded.speed) ? loaded.speed : DEFAULT_SETTINGS.speed
  };
}

export function saveSettings(settings) {
  setItem(KEY, settings);
}
