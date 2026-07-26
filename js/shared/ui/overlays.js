/**
 * Modal overlay shell — the mechanism behind start, pause and game-over cards.
 *
 * Real DOM with headings and buttons rather than text painted onto the canvas,
 * so screen readers can reach it and the buttons are keyboard-operable.
 * Focus moves into the card on open and returns where it came from on close.
 *
 * This module owns no content: what each overlay says is the game's business.
 * See js/games/tetris/ui/overlays.js.
 */

import { qs, setText, setHidden, clear, el, on } from '../util/dom.js';

/**
 * Ignore button activation for a beat after an overlay opens.
 *
 * This is the auto-restart fix. A hard-drop that tops out opens the game-over
 * overlay; the very same Space keypress then activates whatever button just
 * received focus — restarting instantly and skipping the score. The guard
 * swallows that trailing keypress; a deliberate press a moment later works.
 */
const ACTIVATION_GUARD_MS = 400;

/**
 * @param {object} options
 * @param {(action:string)=>void} options.onAction
 * @param {(kind:string)=>boolean} options.isTerminalKind
 *        Overlays that appear right after gameplay, where a reflexive key is
 *        likely. These focus the card rather than a button.
 */
export function createOverlayShell({
  onAction,
  isTerminalKind = () => false,
  selectors = {}
} = {}) {
  const {
    root: rootSel = '#overlay',
    card: cardSel = '#overlay-card',
    title: titleSel = '#overlay-title',
    body: bodySel = '#overlay-body',
    actions: actionsSel = '#overlay-actions'
  } = selectors;

  const root = qs(rootSel);
  const card = qs(cardSel);
  const titleEl = qs(titleSel);
  const bodyEl = qs(bodySel);
  const actionsEl = qs(actionsSel);

  let lastFocused = null;
  let currentKind = null;
  let openedAt = 0;

  function button(label, action, variant = '') {
    const node = el('button', {
      text: label,
      className: `btn ${variant}`.trim(),
      attrs: { type: 'button' }
    });
    on(node, 'click', () => {
      if (performance.now() - openedAt < ACTIVATION_GUARD_MS) return;
      onAction(action);
    });
    return node;
  }

  function link(label, href, variant = '') {
    return el('a', {
      text: label,
      className: `btn ${variant}`.trim(),
      attrs: { href }
    });
  }

  function open(kind, { title, body, buttons }) {
    currentKind = kind;
    openedAt = performance.now();
    lastFocused = document.activeElement;

    setText(titleEl, title);
    if (typeof body === 'string') {
      setText(bodyEl, body);
    } else if (body instanceof Node) {
      clear(bodyEl);
      bodyEl.appendChild(body);
    } else {
      clear(bodyEl);
    }
    setHidden(bodyEl, !body);

    clear(actionsEl);
    for (const node of buttons) actionsEl.appendChild(node);

    setHidden(root, false);
    requestAnimationFrame(() => {
      // Prefer a real input (high-score entry) — typing a stray Space there is
      // harmless. Otherwise, on terminal overlays focus the card rather than a
      // button, so a reflexive Space has nothing to activate; elsewhere focus
      // the primary action so Enter works without reaching for the mouse.
      const input = card.querySelector('input, select, textarea');
      if (input) { input.focus(); return; }
      if (isTerminalKind(kind)) {
        card.setAttribute('tabindex', '-1');
        card.focus();
      } else {
        actionsEl.querySelector('button')?.focus();
      }
    });
  }

  function close() {
    currentKind = null;
    setHidden(root, true);
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
    lastFocused = null;
  }

  // Keep Tab inside the card while it is open.
  on(root, 'keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(card.querySelectorAll('button'));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  return {
    open,
    close,
    button,
    link,
    get isOpen() { return currentKind !== null; },
    get kind() { return currentKind; }
  };
}
