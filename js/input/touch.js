import { ACTIONS } from '../core/game.js';
import { on, qs, setHidden } from '../util/dom.js';

export function createTouch(engine) {
  let touchStartX = 0;
  let touchStartY = 0;
  let lastTouchX = 0;
  let lastTouchY = 0;
  
  const SWIPE_THRESHOLD = 30; // pixels to trigger a move

  const field = qs('#field-stack');
  const touchpad = qs('#touchpad');

  // Show on-screen controls on first touch
  on(window, 'touchstart', () => {
    setHidden(touchpad, false);
  }, { once: true });

  on(field, 'touchstart', (e) => {
    e.preventDefault(); // Prevent scrolling
    const touch = e.changedTouches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    lastTouchX = touchStartX;
    lastTouchY = touchStartY;
  }, { passive: false });

  on(field, 'touchmove', (e) => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    const dx = touch.clientX - lastTouchX;
    const dy = touch.clientY - lastTouchY;

    if (dx > SWIPE_THRESHOLD) {
      engine.dispatch(ACTIONS.MOVE_RIGHT);
      lastTouchX = touch.clientX;
    } else if (dx < -SWIPE_THRESHOLD) {
      engine.dispatch(ACTIONS.MOVE_LEFT);
      lastTouchX = touch.clientX;
    }

    if (dy > SWIPE_THRESHOLD) {
      engine.dispatch(ACTIONS.SOFT_DROP);
      lastTouchY = touch.clientY;
    }
  }, { passive: false });

  on(field, 'touchend', (e) => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    
    // Tap (very little movement) to hard drop
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      engine.dispatch(ACTIONS.HARD_DROP);
    }
  });

  // Touchpad buttons
  document.querySelectorAll('.tbtn').forEach(btn => {
    on(btn, 'touchstart', (e) => {
      e.preventDefault();
      const actionStr = btn.getAttribute('data-action');
      const action = ACTIONS[actionStr];
      if (action) engine.dispatch(action);
    });
  });
}
