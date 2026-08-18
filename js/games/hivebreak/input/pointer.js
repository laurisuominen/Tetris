/**
 * Drag steering.
 *
 * DIFFERENT FROM BREAKOUT'S POINTER, deliberately. Breakout maps the paddle to
 * the pointer's absolute x, because Breakout was a knob game and the paddle
 * should go exactly where you point. That does not work here: the ship sits at
 * the bottom of a PORTRAIT field, so a thumb placed on it covers the one part
 * of the screen you need to watch, and a thumb placed anywhere else teleports
 * the ship.
 *
 * So this reports a RELATIVE delta from wherever the drag started, re-anchored
 * on every touch. The thumb can rest low and to one side, and the ship moves by
 * however far the thumb moves. A mouse gets the same treatment for one code
 * path — and unlike Breakout there is nothing to lose by it, because there is
 * no absolute position the player is expecting the ship to snap to.
 *
 * DOM stops here: this reports a fraction of the field's width, and the
 * composition root turns it into tile space. Core never learns a screen exists.
 */

import { on } from '../../../shared/util/dom.js';

export function createPointer({ element, onMove }) {
  if (!element) throw new Error('createPointer requires an element to track');

  /** Where the ship was, as a 0..1 fraction, when this drag began. */
  let anchorFraction = null;
  let anchorClientX = 0;
  let fraction = null;

  function widthOf() {
    const rect = element.getBoundingClientRect();
    return rect.width < 1 ? 0 : rect.width;
  }

  const offDown = on(element, 'pointerdown', (event) => {
    event.preventDefault();
    element.setPointerCapture?.(event.pointerId);
    anchorClientX = event.clientX;
    // A drag that starts before the ship has ever been steered anchors at the
    // middle, which is where the ship starts.
    anchorFraction = fraction ?? 0.5;
  }, { passive: false });

  const offMove = on(element, 'pointermove', (event) => {
    if (anchorFraction === null) return;
    if (event.pointerType !== 'mouse' && event.buttons === 0) return;
    const width = widthOf();
    if (!width) return;
    event.preventDefault();

    const delta = (event.clientX - anchorClientX) / width;
    fraction = Math.min(Math.max(anchorFraction + delta, 0), 1);
    onMove?.(fraction);
  }, { passive: false });

  const release = (event) => {
    element.releasePointerCapture?.(event.pointerId);
    // Keep `fraction` — the ship stays where the player left it. Only the
    // anchor is dropped, so the next touch re-anchors there rather than
    // snapping the ship to the finger.
    anchorFraction = null;
  };

  const offUp = on(element, 'pointerup', release);
  const offCancel = on(element, 'pointercancel', release);

  return {
    /** 0..1 across the field, or null if the ship has never been dragged. */
    get fraction() { return fraction; },

    /** Hands control back to the keyboard until the next drag. */
    release() {
      fraction = null;
      anchorFraction = null;
    },

    destroy() {
      offMove();
      offDown();
      offUp();
      offCancel();
    }
  };
}
