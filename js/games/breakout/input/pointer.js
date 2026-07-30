/**
 * Absolute-position paddle control: mouse, stylus and finger.
 *
 * Breakout was a knob game, and every high-traffic brick-breaker on the web
 * still maps the paddle to the pointer's x-position directly rather than to a
 * relative drag. The paddle goes where you point, immediately. Relative drag
 * needs a reference point the player cannot see and re-anchors on every touch,
 * which reads as drift.
 *
 * The finger sits wherever it likes — usually low, below the paddle — because
 * only x is read. That is what stops the hand covering the thing it is aiming.
 *
 * DOM stops here. This reports a fraction of the field's width, 0 at the left
 * edge and 1 at the right; the composition root turns that into cell space.
 * Core never learns that a screen exists.
 */

import { on } from '../../../shared/util/dom.js';

export function createPointer({ element, onMove }) {
  if (!element) throw new Error('createPointer requires an element to track');

  let fraction = null;

  function report(clientX) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 1) return;
    const next = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    fraction = next;
    onMove?.(next);
  }

  // pointermove covers mouse, pen and touch in one path. It is only meaningful
  // for a finger while it is down, hence the button/pressure check.
  const offMove = on(element, 'pointermove', (event) => {
    if (event.pointerType !== 'mouse' && event.buttons === 0) return;
    event.preventDefault();
    report(event.clientX);
  }, { passive: false });

  const offDown = on(element, 'pointerdown', (event) => {
    event.preventDefault();
    element.setPointerCapture?.(event.pointerId);
    report(event.clientX);
  }, { passive: false });

  // Releasing does NOT clear the last position. The paddle should stay where
  // the player left it, not snap back to the middle or to wherever the mouse
  // happens to rest.
  const offUp = on(element, 'pointerup', (event) => {
    element.releasePointerCapture?.(event.pointerId);
  });

  return {
    /** 0..1 across the field, or null if the pointer has never been used. */
    get fraction() { return fraction; },

    /** Hands control back to the keyboard until the pointer moves again. */
    release() { fraction = null; },

    destroy() {
      offMove();
      offDown();
      offUp();
    }
  };
}
