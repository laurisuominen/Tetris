import { getItem, setItem } from './storage.js';

const KEY = 'tetris_settings_v1';
export const DEFAULT_SETTINGS = Object.freeze({
  motion: 'auto',
  classicColors: false,
  ghostPiece: true,
  volume: 0.5,
  haptics: true,
  swipeControls: true
});

const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

export function loadSettings() {
  const loaded = getItem(KEY, {});
  // Validate and clamp types so a bad or hostile blob can't break the game.
  return {
    motion: ['auto', 'off'].includes(loaded.motion) ? loaded.motion : DEFAULT_SETTINGS.motion,
    classicColors: bool(loaded.classicColors, DEFAULT_SETTINGS.classicColors),
    ghostPiece: bool(loaded.ghostPiece, DEFAULT_SETTINGS.ghostPiece),
    volume: typeof loaded.volume === 'number' && loaded.volume >= 0 && loaded.volume <= 1
      ? loaded.volume : DEFAULT_SETTINGS.volume,
    haptics: bool(loaded.haptics, DEFAULT_SETTINGS.haptics),
    swipeControls: bool(loaded.swipeControls, DEFAULT_SETTINGS.swipeControls)
  };
}

export function saveSettings(settings) {
  setItem(KEY, settings);
}
