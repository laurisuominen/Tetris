/**
 * Sound effects, driven from engine events so mouse, keyboard and touch sound
 * alike.
 *
 * Breakout's audio has one problem the other two games do not: the bounce is
 * the most frequent event in the game and also the most important one to hear.
 * The original solved it with four distinct pitches — the higher the brick row,
 * the higher the blip — which is genuinely useful information rather than
 * decoration, because it tells you what you just scored without looking.
 *
 * Wall and paddle bounces are deliberately duller and quieter than brick hits.
 * At speed the ball can hit a wall several times a second, and anything with
 * body to it becomes a rattle within thirty seconds of play.
 */

/** Brick pitch by point value: the classic four rows, low to high. */
const BRICK_PITCH = Object.freeze({ 1: 392, 3: 494, 5: 587, 7: 740 });

export function createSfx(engine, synth, getSettings) {
  const getVolume = () => getSettings().volume;

  engine.on('bounce', ({ surface }) => {
    const vol = getVolume();
    if (vol <= 0) return;

    if (surface === 'paddle') {
      synth.playTone({ freq: 220, type: 'square', duration: 0.035, volume: 0.10 * vol });
      return;
    }
    // Walls and the ceiling: the quietest thing in the game.
    synth.playTone({ freq: 165, type: 'triangle', duration: 0.025, volume: 0.05 * vol });
  });

  engine.on('brick', ({ points, row }) => {
    const vol = getVolume();
    if (vol <= 0) return;
    // points already carries the level multiplier, so the pitch is keyed off
    // the row's base value instead — otherwise level 9 would be inaudible.
    const base = [7, 7, 5, 5, 3, 3, 1, 1][row] ?? 1;
    synth.playTone({
      freq: BRICK_PITCH[base] ?? 392,
      type: 'sine', duration: 0.07, volume: 0.18 * vol
    });
  });

  engine.on('speedUp', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    // A short rising sweep: the ball just got faster and that is worth knowing.
    synth.playTone({ freq: 330, type: 'sine', duration: 0.12, volume: 0.14 * vol, sweep: 180 });
  });

  engine.on('brokeThrough', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 660, type: 'sine', duration: 0.2, volume: 0.2 * vol, sweep: 220 });
  });

  engine.on('launch', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 440, type: 'sine', duration: 0.06, volume: 0.14 * vol, sweep: 120 });
  });

  engine.on('lifeLost', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 200, type: 'square', duration: 0.22, volume: 0.22 * vol, sweep: -90 });
  });

  engine.on('levelClear', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      setTimeout(() => {
        synth.playTone({ freq, type: 'sine', duration: 0.16, volume: 0.2 * vol });
      }, i * 90);
    });
  });

  engine.on('gameOver', ({ won }) => {
    const vol = getVolume();
    if (vol <= 0) return;

    if (won) {
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
