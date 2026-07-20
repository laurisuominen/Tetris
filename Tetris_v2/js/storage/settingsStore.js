import { getItem, setItem } from './storage.js';

const KEY = 'tetris_settings_v1';
export const DEFAULT_SETTINGS = Object.freeze({
  motion: 'auto',
  classicColors: false,
  ghostPiece: true,
  volume: 0.5
});

export function loadSettings() {
  const loaded = getItem(KEY, {});
  // Validate and clamp types to ensure a bad blob doesn't break things
  return {
    motion: ['auto', 'off'].includes(loaded.motion) ? loaded.motion : DEFAULT_SETTINGS.motion,
    classicColors: typeof loaded.classicColors === 'boolean' ? loaded.classicColors : DEFAULT_SETTINGS.classicColors,
    ghostPiece: typeof loaded.ghostPiece === 'boolean' ? loaded.ghostPiece : DEFAULT_SETTINGS.ghostPiece,
    volume: typeof loaded.volume === 'number' && loaded.volume >= 0 && loaded.volume <= 1 ? loaded.volume : DEFAULT_SETTINGS.volume
  };
}

export function saveSettings(settings) {
  setItem(KEY, settings);
}
