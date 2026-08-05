/**
 * Report a gamer tag.
 *
 * Reached from the "Report" link beside a verified name on any leaderboard,
 * which passes the tag as `?tag=`. This replaces an inline control that opened
 * a text input inside the table cell — see js/shared/account/reportLink.js for
 * what was wrong with that.
 *
 * Page-module idiom, as in reset.js: no exported init, no DOMContentLoaded,
 * top-level side effects against a mount point the document already contains.
 * The same three invisible constraints apply — no <form> (`form-action 'none'`
 * blocks a real submit, so Enter is wired by hand), no inline style attributes
 * (`style-src 'self'` drops them silently), no innerHTML.
 *
 * The tag in the query string is PUBLIC data — it is printed on the leaderboard
 * this link came from — so putting it in the URL discloses nothing. The reason
 * is not, and is only ever sent in a POST body.
 *
 * What this page must not do is confirm whether a tag exists. report-name
 * answers identically either way, deliberately, so that a stranger cannot use
 * it to enumerate accounts. So the success copy says the report was received
 * and nothing more.
 */

import { el, qs, on, setText, clear } from '../../shared/util/dom.js';
import { createA11y } from '../../shared/ui/a11y.js';
import { getSession } from '../../shared/net/auth.js';
import { reportName } from '../../shared/net/moderation.js';

const root = qs('#report-root');
const a11y = createA11y({ liveRegion: qs('#report-live') });

/* MAX_REASON_LENGTH in supabase/functions/report-name/index.ts. A courtesy
   limit; the server is what enforces it and answers 400 past it. */
const MAX_REASON = 300;

/* MAX_TAG_LENGTH in the same function. A tag is at most 15 characters, but the
   lookup accepts up to 100 so that an over-long value is a miss rather than a
   validation error that would distinguish it from a real one. */
const MAX_TAG = 100;

/**
 * The tag under report.
 *
 * URLSearchParams handles the decoding, including a `+` for a space, which a
 * hand-rolled split on '=' would get wrong.
 */
function tagFromQuery() {
  const raw = new URLSearchParams(window.location.search).get('tag') ?? '';
  return raw.trim().slice(0, MAX_TAG);
}

function messageFor(error) {
  const message = error && typeof error.message === 'string' ? error.message.trim() : '';
  return message || 'Could not send that report. Please check your connection and try again.';
}

/* --- Builders ------------------------------------------------------------- */

function card(title) {
  const wrap = el('section', { className: 'card' });
  wrap.appendChild(el('h2', { className: 'card__title', text: title }));
  return wrap;
}

/** Goes back to the leaderboard that linked here, or to the arcade. */
function backButton(label = 'Back') {
  const button = el('button', {
    className: 'btn btn--ghost',
    text: label,
    attrs: { type: 'button' }
  });
  on(button, 'click', () => {
    // history.back() keeps the player's place in the table, which a link to '/'
    // would throw away. A pasted or bookmarked URL has no history to go back
    // to, hence the fallback.
    if (window.history.length > 1) window.history.back();
    else window.location.assign('/');
  });
  return button;
}

function actions(...nodes) {
  const wrap = el('div', { className: 'actions' });
  for (const node of nodes) wrap.appendChild(node);
  return wrap;
}

function show(node) {
  clear(root);
  root.appendChild(node);
}

/* --- Screens -------------------------------------------------------------- */

/** No `?tag=`, so this page was opened directly rather than from a board. */
function renderNoTag() {
  const wrap = card('Nothing to report');
  wrap.appendChild(el('p', {
    className: 'card__lead',
    text: 'This page reports one gamer tag, and no tag was given. Open a leaderboard and use the Report link beside the name you mean.'
  }));
  wrap.appendChild(actions(backButton('Back to the arcade')));
  show(wrap);
  a11y.announce('No gamer tag was given.');
}

/**
 * Signed out. Checked up front rather than after the reason is typed: the
 * function answers 401 before it looks anything up, so submitting would be a
 * guaranteed failure that costs the player their writing.
 */
function renderSignedOut(tag) {
  const wrap = card('Sign in to report');
  wrap.appendChild(el('p', {
    className: 'card__lead',
    text: `Reports are attached to the account that makes them, so you need to be signed in to report ${tag}.`
  }));
  wrap.appendChild(actions(
    el('a', { className: 'btn', text: 'Sign in', attrs: { href: '../' } }),
    backButton('Cancel')
  ));
  show(wrap);
  a11y.announce('You need to be signed in to report a name.');
}

/** Sent. Deliberately claims only that the report was received. */
function renderSent(tag) {
  const wrap = card('Report sent');
  wrap.appendChild(el('p', {
    className: 'card__lead',
    text: `Thank you. Your report about ${tag} has been received and a human will review it.`
  }));
  wrap.appendChild(actions(backButton('Back')));
  show(wrap);
  a11y.announce(`Reported ${tag}.`);
}

function renderForm(tag) {
  const wrap = card('Report a gamer tag');

  /* The tag, stated back. The player clicked a link in a table of similar
     names; this page has to make it unmistakable which one they landed on. */
  const summary = el('dl', { className: 'profile' });
  summary.appendChild(el('dt', { className: 'profile__key', text: 'Reporting' }));
  summary.appendChild(el('dd', { className: 'profile__value profile__value--tag', text: tag }));
  wrap.appendChild(summary);

  const fields = el('div', { className: 'fields' });
  const field = el('div', { className: 'field' });

  field.appendChild(el('label', {
    className: 'field__label',
    text: 'What is wrong with this tag?',
    attrs: { for: 'report-reason' }
  }));

  const input = el('textarea', {
    className: 'field__input field__input--reason',
    attrs: {
      id: 'report-reason',
      rows: '4',
      maxLength: String(MAX_REASON),
      placeholder: 'A sentence is plenty.',
      'aria-describedby': 'report-reason-hint report-reason-error'
    }
  });
  field.appendChild(input);

  field.appendChild(el('p', {
    className: 'field__hint',
    text: `Up to ${MAX_REASON} characters. This is the only thing a moderator sees besides the tag, so a slur, an impersonation or a joke are worth telling apart.`,
    attrs: { id: 'report-reason-hint' }
  }));

  const error = el('p', { className: 'field__error', attrs: { id: 'report-reason-error' } });
  field.appendChild(error);

  fields.appendChild(field);
  wrap.appendChild(fields);

  const send = el('button', { className: 'btn', text: 'Send report', attrs: { type: 'button' } });
  wrap.appendChild(actions(send, backButton('Cancel')));

  const status = el('p', { className: 'status', attrs: { role: 'status' } });
  wrap.appendChild(status);

  function setStatus(message, kind) {
    setText(status, message);
    status.className = kind ? `status status--${kind}` : 'status';
    a11y.announce(message);
  }

  async function submit() {
    // A click and a Ctrl+Enter can both arrive; disabled is the latch.
    if (send.disabled) return;

    const reason = input.value.trim();
    if (reason === '') {
      // Required here, optional at the server. A report with no reason is
      // technically valid and practically useless — a moderator looking at
      // `SALT` with an empty reason cannot tell what they are being asked
      // about. Asking on this page costs a sentence; guessing costs a wrong
      // ban.
      setText(error, 'Please say briefly what is wrong with this tag.');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      a11y.announce('Please say briefly what is wrong with this tag.');
      return;
    }

    setText(error, '');
    input.removeAttribute('aria-invalid');

    send.disabled = true;
    input.disabled = true;
    setStatus('Sending…');

    try {
      await reportName(tag, reason);
      renderSent(tag);
    } catch (err) {
      // moderation.js now unpacks the Edge Function's own wording, so this
      // shows "You cannot report yourself" rather than one generic apology for
      // every distinct failure.
      setStatus(messageFor(err), 'error');
      send.disabled = false;
      input.disabled = false;
      console.error('Report failed', err);
    }
  }

  on(send, 'click', submit);

  // Enter inserts a newline in a textarea and should keep doing so. Ctrl/Cmd +
  // Enter is the usual "send" for a multi-line field.
  on(input, 'keydown', (event) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    submit();
  });

  show(wrap);
  input.focus();
}

/* --- Boot ----------------------------------------------------------------- */

const tag = tagFromQuery();

if (tag === '') {
  renderNoTag();
} else {
  const loading = card('Checking…');
  loading.appendChild(el('p', { className: 'card__lead', text: 'One moment.' }));
  show(loading);

  getSession()
    .then((session) => {
      if (session) renderForm(tag);
      else renderSignedOut(tag);
    })
    .catch((error) => {
      // A failed session LOOKUP is not proof of being signed out, and telling a
      // signed-in player to sign in is a dead end. Show the form and let the
      // server decide — its 401 wording now reaches the screen intact.
      console.error('Session lookup failed', error);
      renderForm(tag);
    });
}
