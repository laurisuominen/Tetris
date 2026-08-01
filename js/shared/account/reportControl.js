/**
 * "Report" control for a gamer tag on a leaderboard.
 *
 * Built from classed elements only. Every page that uses this ships
 * `style-src 'self'` with no unsafe-inline, which governs style attributes as
 * well as <style> blocks, so an inline style here would be dropped silently and
 * the control would render unstyled.
 *
 * Deliberately collapsed by default. A reason field permanently open on every
 * row turns a leaderboard into a wall of form controls, and the overwhelming
 * majority of rows will never be reported.
 *
 * This module builds DOM but performs no network call of its own — it delegates
 * to js/shared/net/moderation.js, keeping the "no fetch outside net/" invariant
 * intact.
 */

import { el, on, setText } from '../util/dom.js';
import { reportName } from '../net/moderation.js';

const MAX_REASON = 300;

/**
 * @param {string} gamerTag The tag this control reports.
 * @param {(message: string) => void} [announce] Optional a11y announcer.
 * @returns {HTMLElement} A container to append next to the name.
 */
export function createReportControl(gamerTag, announce = () => {}) {
  const wrap = el('span', { className: 'report' });

  const toggle = el('button', {
    className: 'report__toggle',
    text: 'Report',
    attrs: {
      type: 'button',
      // The visible label is just "Report", which is meaningless out of
      // context — a screen reader reading the row needs to know which name.
      'aria-label': `Report the gamer tag ${gamerTag}`,
      'aria-expanded': 'false'
    }
  });

  const panel = el('span', { className: 'report__panel' });
  panel.hidden = true;

  const input = el('input', {
    className: 'report__reason',
    attrs: {
      type: 'text',
      maxLength: String(MAX_REASON),
      placeholder: 'Reason (optional)',
      'aria-label': `Reason for reporting ${gamerTag}`
    }
  });

  const send = el('button', {
    className: 'report__send',
    text: 'Send',
    attrs: { type: 'button' }
  });

  const status = el('span', { className: 'report__status', attrs: { role: 'status' } });

  panel.appendChild(input);
  panel.appendChild(send);
  wrap.appendChild(toggle);
  wrap.appendChild(panel);
  wrap.appendChild(status);

  on(toggle, 'click', () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
    if (opening) input.focus();
  });

  async function submit() {
    // A click and an Enter can both arrive; disabled is the latch.
    if (send.disabled) return;
    send.disabled = true;
    input.disabled = true;

    setText(status, 'Sending…');
    status.className = 'report__status';

    try {
      await reportName(gamerTag, input.value.trim());
      // The server answers identically whether or not the tag existed, so this
      // message must not claim more than "we received it".
      setText(status, 'Reported. Thank you.');
      status.className = 'report__status report__status--ok';
      announce(`Reported ${gamerTag}`);
      panel.hidden = true;
      toggle.hidden = true;
    } catch (error) {
      setText(status, 'Could not send that report.');
      status.className = 'report__status report__status--error';
      announce('The report could not be sent.');
      send.disabled = false;
      input.disabled = false;
      console.error('Report failed', error);
    }
  }

  on(send, 'click', submit);

  // No <form> here — every page ships form-action 'none', so a real submit is
  // blocked and Enter gives nothing for free.
  on(input, 'keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  });

  return wrap;
}
