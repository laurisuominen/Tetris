/**
 * Sound effects, driven from engine events so keys, swipes and the D-pad all
 * sound alike. Everything is synthesised — one oscillator in
 * js/shared/audio/synth.js, no audio files, same as the other four games.
 *
 * The problem specific to this game is that DOTS are relentless: up to about
 * seven a second for minutes on end. The original solved it with a two-note
 * alternation that reads as a chomp rather than as a beep, and that alternation
 * is the only reason the sound is bearable. Copying a single fixed blip here
 * produces something nobody can listen to for a whole board.
 */

const CHOMP = [320, 240];

export function createSfx(engine, synth, getSettings) {
  const getVolume = () => getSettings().volume;
  let chompFlip = 0;

  engine.on('dot', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({
      freq: CHOMP[chompFlip],
      type: 'square',
      duration: 0.045,
      volume: 0.06 * vol
    });
    chompFlip ^= 1;
  });

  engine.on('energizer', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 160, type: 'square', duration: 0.18, volume: 0.14 * vol, sweep: 90 });
  });

  engine.on('ghostEaten', ({ points }) => {
    const vol = getVolume();
    if (vol <= 0) return;
    // Pitch climbs with the chain, so 200/400/800/1600 is audible as a run.
    const step = [0, 1, 2, 3].indexOf([200, 400, 800, 1600].indexOf(points));
    const base = 420 + Math.max([200, 400, 800, 1600].indexOf(points), 0) * 110;
    synth.playTone({ freq: base, type: 'square', duration: 0.16, volume: 0.18 * vol, sweep: 220 });
  });

  engine.on('fruitEaten', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 520, type: 'sine', duration: 0.22, volume: 0.18 * vol, sweep: 260 });
  });

  engine.on('extraLife', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 660, type: 'square', duration: 0.3, volume: 0.2 * vol, sweep: 340 });
  });

  engine.on('died', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 420, type: 'sawtooth', duration: 0.7, volume: 0.22 * vol, sweep: -360 });
  });

  engine.on('levelClear', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 480, type: 'square', duration: 0.18, volume: 0.16 * vol, sweep: 260 });
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
