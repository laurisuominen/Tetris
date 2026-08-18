/**
 * Sound effects, driven from engine events so keyboard, buttons and drag all
 * sound alike.
 *
 * Everything is synthesised — one oscillator in js/shared/audio/synth.js, no
 * audio files, same as the other three games.
 *
 * The problem specific to this game is DENSITY. The gun fires up to ten times a
 * second and there can be a dozen things dying at once, so the mix is built
 * around the shot being almost inaudible and the rare events being loud. A
 * shooter where every shot is satisfying on its own is unbearable after twenty
 * seconds of holding the trigger.
 */

/** Kill pitch by enemy kind: higher up the formation, higher the note. */
const KILL_PITCH = Object.freeze({
  BEE: 420,
  BUTTERFLY: 520,
  BOSS: 300
});

export function createSfx(engine, synth, getSettings) {
  const getVolume = () => getSettings().volume;

  engine.on('shoot', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    // The quietest thing in the game, and deliberately a short tick rather
    // than a pew — at ten a second, anything with body becomes a drill.
    synth.playTone({ freq: 880, type: 'square', duration: 0.025, volume: 0.05 * vol });
  });

  engine.on('kill', ({ kind, diving }) => {
    const vol = getVolume();
    if (vol <= 0) return;
    const base = KILL_PITCH[kind] ?? 420;
    synth.playTone({
      freq: base,
      type: 'square',
      duration: 0.09,
      // A diving kill is the one worth more, so it is the one you hear.
      volume: (diving ? 0.16 : 0.11) * vol,
      sweep: -180
    });
  });

  engine.on('armour', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    // A boss shrugging off a hit: dull, no pitch drop, clearly not a kill.
    synth.playTone({ freq: 180, type: 'square', duration: 0.05, volume: 0.10 * vol });
  });

  engine.on('enemyShoot', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 220, type: 'sawtooth', duration: 0.05, volume: 0.05 * vol });
  });

  engine.on('beamOpen', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    // Rising, because it is a warning about something that has not happened yet.
    synth.playTone({ freq: 300, type: 'sine', duration: 0.55, volume: 0.16 * vol, sweep: 420 });
  });

  engine.on('captured', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 520, type: 'sine', duration: 0.7, volume: 0.2 * vol, sweep: -400 });
  });

  engine.on('rescued', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    // The best thing that can happen, and the only rising two-note figure.
    synth.playTone({ freq: 440, type: 'square', duration: 0.12, volume: 0.2 * vol });
    setTimeout(() => {
      synth.playTone({ freq: 660, type: 'square', duration: 0.22, volume: 0.2 * vol, sweep: 160 });
    }, 110);
  });

  engine.on('shipHit', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 200, type: 'sawtooth', duration: 0.45, volume: 0.24 * vol, sweep: -170 });
  });

  engine.on('stageClear', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 520, type: 'square', duration: 0.16, volume: 0.16 * vol, sweep: 240 });
  });

  engine.on('gameOver', ({ won }) => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({
      freq: won ? 440 : 300,
      type: 'sine',
      duration: 0.9,
      volume: 0.22 * vol,
      sweep: won ? 300 : -220
    });
  });
}
