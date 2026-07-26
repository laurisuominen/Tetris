export function createSynth() {
  let ctx = null;

  function init() {
    if (ctx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      ctx = new AudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
    }
  }

  function playTone({ freq, type = 'sine', duration = 0.1, volume = 0.5, sweep = 0 }) {
    if (!ctx) return;
    
    // browser autoplay policy might pause the context
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweep) {
      osc.frequency.exponentialRampToValueAtTime(freq + sweep, ctx.currentTime + duration);
    }

    // Envelope
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  // Bind to first interaction to initialize audio context (spec requirement for autoplay)
  const onInteract = () => {
    init();
    window.removeEventListener('touchstart', onInteract);
    window.removeEventListener('click', onInteract);
    window.removeEventListener('keydown', onInteract);
  };
  window.addEventListener('touchstart', onInteract, { once: true });
  window.addEventListener('click', onInteract, { once: true });
  window.addEventListener('keydown', onInteract, { once: true });

  return { playTone };
}
