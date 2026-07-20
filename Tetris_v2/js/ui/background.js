import { mulberry32 } from '../core/rng.js';

export function createBackgrounds({ canvasA, canvasB }) {
  let currentA = true;

  const generators = [
    // 0: Dot matrix
    (ctx, width, height, rand) => {
      ctx.fillStyle = 'oklch(0.3 0.05 265)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      const spacing = 40;
      for (let x = 0; x < width; x += spacing) {
        for (let y = 0; y < height; y += spacing) {
          if (rand() > 0.5) ctx.fillRect(x, y, 4, 4);
        }
      }
    },
    // 1: Radial glow
    (ctx, width, height, rand) => {
      const cx = width / 2;
      const cy = height / 2;
      const r = Math.max(width, height);
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const hue = 200 + rand() * 100;
      gradient.addColorStop(0, `oklch(0.5 0.1 ${hue})`);
      gradient.addColorStop(1, 'oklch(0.3 0.05 265)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    },
    // 2: Gradient bands
    (ctx, width, height, rand) => {
      const hue1 = 200 + rand() * 60;
      const hue2 = hue1 + 60;
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, `oklch(0.4 0.1 ${hue1})`);
      gradient.addColorStop(1, `oklch(0.45 0.12 ${hue2})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      for (let y = 0; y < height; y += 30) {
        if (rand() > 0.5) ctx.fillRect(0, y, width, 15);
      }
    },
    // 3: Grid rays
    (ctx, width, height, rand) => {
      const hue = 260 + rand() * 40;
      ctx.fillStyle = `oklch(0.35 0.08 ${hue})`;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = `oklch(0.22 0.04 ${hue})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const cx = width / 2;
      const cy = height / 2;
      for (let i = 0; i < Math.PI * 2; i += 0.2) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(i) * width, cy + Math.sin(i) * width);
      }
      ctx.stroke();
    }
  ];

  let currentLevel = 1;

  function drawLevel(level) {
    currentLevel = level;
    const targetCanvas = currentA ? canvasA : canvasB;
    const oldCanvas = currentA ? canvasB : canvasA;
    
    // Switch active
    currentA = !currentA;
    
    // Draw in background
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    if (width === 0 || height === 0) return;

    targetCanvas.width = width;
    targetCanvas.height = height;

    const ctx = targetCanvas.getContext('2d');
    const rand = mulberry32(level * 12345);
    const gen = generators[(level - 1) % generators.length];
    
    // Use setTimeout instead of requestIdleCallback to ensure it runs consistently across browsers
    setTimeout(() => {
      gen(ctx, width, height, rand);
      
      // Cross-fade via CSS data attributes
      targetCanvas.setAttribute('data-visible', 'true');
      oldCanvas.setAttribute('data-visible', 'false');
    }, 10);
  }

  // Draw initial once window is ready
  if (document.readyState === 'complete') {
    drawLevel(1);
  } else {
    window.addEventListener('load', () => drawLevel(1), { once: true });
  }

  // Handle window resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      // Force immediate redraw of current level on resize, no crossfade logic swap needed if we just redraw the active one
      const activeCanvas = currentA ? canvasB : canvasA; 
      if (!activeCanvas) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      activeCanvas.width = width;
      activeCanvas.height = height;
      const ctx = activeCanvas.getContext('2d');
      const rand = mulberry32(currentLevel * 12345);
      const gen = generators[(currentLevel - 1) % generators.length];
      gen(ctx, width, height, rand);
    }, 200);
  });

  return {
    drawLevel
  };
}
