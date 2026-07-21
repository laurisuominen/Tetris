/**
 * Haptic feedback via the Vibration API.
 *
 * Gracefully absent where unsupported (notably iOS Safari, which has no
 * navigator.vibrate) and fully gated on the haptics setting. Driven from engine
 * events in main.js, so both keyboard and touch play produce the same feel with
 * no per-input wiring.
 *
 * The `move` channel is throttled: without it, DAS and soft-drop would fire a
 * pulse every few tens of milliseconds and turn the phone into a continuous
 * buzz.
 */

const MOVE_THROTTLE_MS = 90;

export function createHaptics(getSettings) {
  const supported =
    typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  let lastMove = 0;

  const enabled = () => supported && getSettings().haptics !== false;

  const buzz = (pattern) => {
    if (!enabled()) return;
    try { navigator.vibrate(pattern); } catch { /* device refused; ignore */ }
  };

  return {
    supported,

    /** Move / rotate / hold — a barely-there tick, rate-limited. */
    light() {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (now - lastMove < MOVE_THROTTLE_MS) return;
      lastMove = now;
      buzz(10);
    },

    /** Line clear — a clearly felt pulse. */
    medium() { buzz(35); },

    /** Hard drop — a solid thud. */
    hardDrop() { buzz(45); },

    /** Game over — an unmistakable pattern. */
    gameOver() { buzz([60, 40, 60, 40, 120]); },

    /** Stop any ongoing vibration (e.g. on pause). */
    silence() { if (supported) { try { navigator.vibrate(0); } catch { /* ignore */ } } }
  };
}
