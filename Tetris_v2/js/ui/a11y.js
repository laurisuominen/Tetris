import { setText } from '../util/dom.js';

export function createA11y({ liveRegion }) {
  return {
    announce(message) {
      if (liveRegion && message) {
        setText(liveRegion, message);
      }
    }
  };
}
