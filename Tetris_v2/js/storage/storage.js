/**
 * Safe localStorage wrapper.
 * Private browsing modes can throw on access, and setting can throw on quota.
 * A corrupt blob must also not brick the game.
 */

export function getItem(key, defaultValue) {
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) return defaultValue;
    return JSON.parse(value);
  } catch (e) {
    console.warn(`Failed to read from localStorage for key ${key}:`, e);
    return defaultValue;
  }
}

export function setItem(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Failed to write to localStorage for key ${key}:`, e);
  }
}
