export function createSfx(engine, synth, getSettings) {
  const getVolume = () => getSettings().volume;

  engine.on('move', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 220, type: 'triangle', duration: 0.05, volume: 0.1 * vol });
  });

  engine.on('rotate', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 330, type: 'sine', duration: 0.08, volume: 0.15 * vol });
  });

  engine.on('hold', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 440, type: 'sine', duration: 0.1, volume: 0.15 * vol, sweep: -100 });
  });

  engine.on('lock', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 110, type: 'square', duration: 0.12, volume: 0.2 * vol });
  });

  engine.on('hardDrop', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 80, type: 'square', duration: 0.15, volume: 0.3 * vol, sweep: -40 });
  });

  engine.on('clear', ({ lines }) => {
    const vol = getVolume();
    if (vol <= 0 || lines === 0) return;
    
    // Play a chord depending on lines cleared
    const baseFreq = 440;
    synth.playTone({ freq: baseFreq, type: 'triangle', duration: 0.3, volume: 0.2 * vol });
    if (lines >= 2) synth.playTone({ freq: baseFreq * 1.25, type: 'triangle', duration: 0.3, volume: 0.2 * vol });
    if (lines >= 3) synth.playTone({ freq: baseFreq * 1.5, type: 'triangle', duration: 0.3, volume: 0.2 * vol });
    if (lines >= 4) synth.playTone({ freq: baseFreq * 2.0, type: 'triangle', duration: 0.4, volume: 0.2 * vol });
  });

  engine.on('levelUp', () => {
    const vol = getVolume();
    if (vol <= 0) return;
    synth.playTone({ freq: 523.25, type: 'sine', duration: 0.1, volume: 0.3 * vol });
    setTimeout(() => synth.playTone({ freq: 659.25, type: 'sine', duration: 0.1, volume: 0.3 * vol }), 100);
    setTimeout(() => synth.playTone({ freq: 783.99, type: 'sine', duration: 0.3, volume: 0.3 * vol }), 200);
  });
}
