/**
 * DOM helpers.
 *
 * There is deliberately NO html() or innerHTML helper here. Every path to the
 * screen goes through textContent, so the ergonomic option is also the safe
 * one and there is no convenient way to introduce an injection.
 */

export const qs = (selector, root = document) => root.querySelector(selector);

export const qsa = (selector, root = document) =>
  Array.from(root.querySelectorAll(selector));

export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/** The only way this codebase writes text into an element. */
export function setText(element, text) {
  if (element) element.textContent = String(text);
}

export function toggleClass(element, name, active) {
  element?.classList.toggle(name, Boolean(active));
}

export function setHidden(element, hidden) {
  if (element) element.hidden = Boolean(hidden);
}

/** Creates an element with text content and attributes. Never parses markup. */
export function el(tag, { text, className, attrs } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    node.setAttribute(key, String(value));
  }
  return node;
}

export function clear(element) {
  if (element) element.textContent = '';
}
