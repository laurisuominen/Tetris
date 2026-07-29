/**
 * Sound effects, driven from engine events so keyboard and touch sound alike.
 *
 * The turn tone is deliberately near-silent and very short. A turn happens
 * several times a second in a tight corner, and anything with body to it
 * becomes a machine-gun within thirty seconds of play.
 */

export function createSfx(engine, synth, getSettings) {
  const getVolume = () => getSettings().volume;

  engine.on('turn', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 300, type: 'triangle', duration: 0.03, volume: 0.05 * vol });
  });

  engine.on('eat', ({ apples }) => {
    const vol = getVolume();
    if (vol <= 0) return;
    // Rising pitch with the run, capped so a long game does not end in a
    // whistle. Every tenth apple gets a brighter tone as a small milestone.
    const freq = Math.min(880, 440 + apples * 12);
    synth.playTone({ freq, type: 'sine', duration: 0.09, volume: 0.2 * vol, sweep: 60 });
    if (apples % 10 === 0) {
      setTimeout(() => {
        synth.playTone({ freq: freq * 1.5, type: 'sine', duration: 0.16, volume: 0.18 * vol });
      }, 70);
    }
  });

  engine.on('die', ({ won }) => {
    const vol = getVolume();
    if (vol <= 0) return;

    if (won) {
      // Filling the board deserves better than the failure tone.
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        setTimeout(() => {
          synth.playTone({ freq, type: 'sine', duration: 0.22, volume: 0.25 * vol });
        }, i * 110);
      });
      return;
    }

    synth.playTone({ freq: 180, type: 'square', duration: 0.28, volume: 0.28 * vol, sweep: -110 });
  });
}
