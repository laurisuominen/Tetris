/** Minimal pub/sub. Depends on nothing. */

export function createEmitter() {
  const listeners = new Map();

  return {
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type)?.delete(fn);
    },

    off(type, fn) {
      listeners.get(type)?.delete(fn);
    },

    emit(type, payload) {
      // A throwing listener must not stop the others or kill the game loop.
      for (const fn of listeners.get(type) ?? []) {
        try { fn(payload); } catch (error) { console.error(error); }
      }
      for (const fn of listeners.get('*') ?? []) {
        try { fn(type, payload); } catch (error) { console.error(error); }
      }
    },

    clear() { listeners.clear(); }
  };
}
