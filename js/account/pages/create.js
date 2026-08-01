/**
 * Create-account page: email, gamer tag and password, then the 6-digit code
 * that lands in the inbox.
 *
 * Page-module idiom, the same as js/games/snake/pages/leaderboard.js: no
 * exported init, no DOMContentLoaded, top-level side effects against a mount
 * point that the document already contains. The prose — tag rules, the ban
 * warning, the email statement — is static and lives in the HTML, so it renders
 * whether or not this module ever runs.
 *
 * Three constraints shape everything below and none of them announce
 * themselves at runtime:
 *
 * 1. No <form>. Every page ships `form-action 'none'`, so a real submit is
 *    blocked outright. The container is a <div>, the button is type="button",
 *    and Enter is wired by hand on each input — the same shape scoresView.js
 *    uses for the initials field.
 * 2. No inline style attributes. `style-src 'self'` with no unsafe-inline
 *    governs style="" as well, and the browser drops it with no console error.
 *    Classes only.
 * 3. No innerHTML. el()/setText are the only paths to the screen.
 */

import { el, qs, on, setText } from '../../shared/util/dom.js';
import { createA11y } from '../../shared/ui/a11y.js';
import { signUp, confirmSignUpCode, getProfile } from '../../shared/net/auth.js';
import { setCachedProfile } from '../../shared/account/session.js';

const root = qs('#create-root');
const a11y = createA11y({ liveRegion: qs('#create-live') });

/*
 * Password floor, taken from supabase/config.toml (minimum_password_length = 8).
 * It is a courtesy check only: the server is what enforces it, and if the two
 * ever diverge the server's own message is what the player sees.
 */
const MIN_PASSWORD = 8;

/*
 * Gamer-tag SHAPE rules, and deliberately not the shared validator.
 *
 * supabase/functions/_shared/gamerTag.js carries the reserved words and the
 * blocklist alongside these rules, and that file must never be served to a
 * browser: shipping the blocklist publishes the exact table an evader needs.
 * The server is the sole authority on whether a tag is allowed. What follows
 * only saves a round trip on an obvious typo, and the wording is copied from
 * the server's strings verbatim so the two can never contradict each other on
 * screen. Anything the server rejects is rendered with the server's own text.
 */
const TAG_LENGTH = 'Gamer tags must be 3 to 15 characters.';
const TAG_CHARSET = 'Gamer tags can only use letters, numbers, hyphens and underscores.';
const TAG_EDGES = 'Gamer tags must start and end with a letter or number.';
const TAG_DOUBLE_SEP = 'Gamer tags cannot use two hyphens or underscores in a row.';

/** @returns {string|null} the failure message, or null when the shape is fine. */
function checkTagShape(raw) {
  const tag = raw.trim();
  // Length first, so short junk reads as "too short" rather than "bad
  // characters" — the same order the server checks in.
  if (tag.length < 3 || tag.length > 15) return TAG_LENGTH;
  if (!/^[A-Za-z0-9_-]+$/.test(tag)) return TAG_CHARSET;
  if (!/^[A-Za-z0-9]/.test(tag) || !/[A-Za-z0-9]$/.test(tag)) return TAG_EDGES;
  // The rules list on this page states this one, so it has to be checked here
  // too. Advertising a rule and then letting the server be the one to enforce
  // it is the worst of both: the player reads it, obeys it or not, and finds
  // out after a round trip either way.
  if (/[_-]{2}/.test(tag)) return TAG_DOUBLE_SEP;
  return null;
}

/* Loose on purpose. The only authority on whether an address works is whether
   the code arrives; this catches a missing @ and nothing more. */
const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * Supabase returns messages worth showing verbatim ("Password should be at
 * least 8 characters", the gamer-tag reason from the before-user-created hook).
 * A network failure has no useful message, hence the fallback.
 */
function messageFor(error) {
  const message = error && typeof error.message === 'string' ? error.message.trim() : '';
  return message || 'Something went wrong. Please check your connection and try again.';
}

/* --- Builders -------------------------------------------------------------
 * Deliberately local to this page rather than a fourth shared module: the three
 * account pages are the only callers, and a shared ui/ module for them is a
 * bigger change than this needs. */

/**
 * A labelled input with a hint and an error line already wired to it.
 * aria-describedby points at both; the error element is empty (and display:none
 * via :empty) until something is actually wrong.
 */
function field({ id, label, type, hint, autocomplete, attrs = {}, className = '' }) {
  const wrap = el('div', { className: 'field' });
  wrap.appendChild(el('label', {
    className: 'field__label', text: label, attrs: { for: id }
  }));

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = hint ? `${hintId} ${errorId}` : errorId;

  const input = el('input', {
    className: `field__input ${className}`.trim(),
    attrs: { id, type, autocomplete, 'aria-describedby': describedBy, ...attrs }
  });
  wrap.appendChild(input);

  if (hint) {
    wrap.appendChild(el('p', { className: 'field__hint', text: hint, attrs: { id: hintId } }));
  }

  const error = el('p', { className: 'field__error', attrs: { id: errorId } });
  wrap.appendChild(error);

  return { wrap, input, error };
}

function showFieldError(target, message) {
  setText(target.error, message);
  target.input.setAttribute('aria-invalid', 'true');
  target.input.focus();
  // Colour alone would leave this invisible to a screen reader, and the error
  // text itself is not in a live region.
  a11y.announce(message);
}

function clearFieldError(target) {
  setText(target.error, '');
  target.input.removeAttribute('aria-invalid');
}

function setStatus(node, message, kind) {
  setText(node, message);
  node.className = kind ? `status status--${kind}` : 'status';
  a11y.announce(message);
}

function card(title, lead) {
  const section = el('section', { className: 'card' });
  section.appendChild(el('h2', { className: 'card__title', text: title }));
  if (lead) section.appendChild(el('p', { className: 'card__lead', text: lead }));
  return section;
}

/** Enter submits, because without a <form> nothing gives that for free. */
function submitOnEnter(input, handler) {
  on(input, 'keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    handler();
  });
}

/* --- Step 1: the details -------------------------------------------------- */

const detailsCard = card('Your details');

const emailField = field({
  id: 'create-email',
  label: 'Email address',
  type: 'email',
  autocomplete: 'email',
  hint: 'Used to confirm you are a real person and to reset a forgotten password. See "About your email address" below.',
  attrs: { autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }
});

const tagField = field({
  id: 'create-tag',
  label: 'Gamer tag',
  type: 'text',
  autocomplete: 'username',
  hint: '3 to 15 characters. Letters, numbers, hyphens and underscores. This is the name other players see.',
  attrs: { autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', maxlength: '15' }
});

const passwordField = field({
  id: 'create-password',
  label: 'Password',
  type: 'password',
  autocomplete: 'new-password',
  hint: `At least ${MIN_PASSWORD} characters.`
});

const detailFields = el('div', { className: 'fields' });
detailFields.appendChild(emailField.wrap);
detailFields.appendChild(tagField.wrap);
detailFields.appendChild(passwordField.wrap);
detailsCard.appendChild(detailFields);

const detailStatus = el('p', { className: 'status' });
detailsCard.appendChild(detailStatus);

const createBtn = el('button', {
  text: 'Create account', className: 'btn', attrs: { type: 'button' }
});
const detailActions = el('div', { className: 'actions' });
detailActions.appendChild(createBtn);
detailsCard.appendChild(detailActions);

/* --- Step 2: the emailed code --------------------------------------------- */

const codeCard = card('Enter your code');
codeCard.hidden = true;

const codeLead = el('p', { className: 'card__lead' });
codeCard.appendChild(codeLead);

const codeField = field({
  id: 'create-code',
  label: '6-digit code',
  type: 'text',
  autocomplete: 'one-time-code',
  className: 'field__input--code',
  hint: 'From the email we just sent. It expires in an hour.',
  attrs: { inputmode: 'numeric', maxlength: '6' }
});

const codeFields = el('div', { className: 'fields' });
codeFields.appendChild(codeField.wrap);
codeCard.appendChild(codeFields);

const codeStatus = el('p', { className: 'status' });
codeCard.appendChild(codeStatus);

const confirmBtn = el('button', {
  text: 'Confirm code', className: 'btn', attrs: { type: 'button' }
});
const codeActions = el('div', { className: 'actions' });
codeActions.appendChild(confirmBtn);
codeCard.appendChild(codeActions);

root.appendChild(detailsCard);
root.appendChild(codeCard);

/* --- Behaviour ------------------------------------------------------------ */

/* Held from step 1 so step 2 can verify against the same address. verifyOtp
   needs the email as well as the code, and asking for it twice is a way to get
   a mismatch. */
let pendingEmail = '';

function setDetailsEnabled(enabled) {
  createBtn.disabled = !enabled;
  emailField.input.disabled = !enabled;
  tagField.input.disabled = !enabled;
  passwordField.input.disabled = !enabled;
}

function setCodeEnabled(enabled) {
  confirmBtn.disabled = !enabled;
  codeField.input.disabled = !enabled;
}

async function createAccount() {
  // A click and an Enter can both arrive; disabled is the latch that stops two
  // signups for one set of details.
  if (createBtn.disabled) return;

  clearFieldError(emailField);
  clearFieldError(tagField);
  clearFieldError(passwordField);

  const email = emailField.input.value.trim();
  const tag = tagField.input.value.trim();
  const password = passwordField.input.value;

  if (!looksLikeEmail(email)) {
    showFieldError(emailField, 'Enter an email address you can receive mail at.');
    return;
  }

  const tagProblem = checkTagShape(tag);
  if (tagProblem) {
    showFieldError(tagField, tagProblem);
    return;
  }

  if (password.length < MIN_PASSWORD) {
    showFieldError(passwordField, `Passwords must be at least ${MIN_PASSWORD} characters.`);
    return;
  }

  setDetailsEnabled(false);
  setStatus(detailStatus, 'Creating your account…');

  try {
    const result = await signUp(email, password, tag);
    pendingEmail = email;

    if (!result.needsConfirmation) {
      // Confirmations are off for the project: the session already exists and
      // there is no code to wait for.
      setStatus(detailStatus, 'Your account is ready.', 'ok');
      await cacheProfileQuietly();
      detailsCard.appendChild(doneActions());
      return;
    }

    if (result.possiblyExisting) {
      /*
       * Supabase does not error on a duplicate address — it returns a success
       * with an empty identities array, on purpose, so the signup form cannot
       * be used to discover which addresses are registered. Saying "check your
       * inbox" would be a lie half the time and saying "that email is taken"
       * would reinstate exactly the oracle the empty array closes. So: word it
       * both ways and commit to neither.
       */
      setText(codeLead,
        'If this address is new, a 6-digit code is on its way to it. If it already '
        + 'has an account, no code will arrive — sign in with it instead, or reset '
        + 'the password.');
      setStatus(detailStatus, 'Check your email.');
    } else {
      setText(codeLead, `We sent a 6-digit code to ${email}. Enter it below to finish.`);
      setStatus(detailStatus, 'Check your email.');
    }

    codeCard.hidden = false;
    a11y.announce('Enter the 6-digit code from your email to finish creating your account.');
    codeField.input.focus();
  } catch (error) {
    // The server's own wording, verbatim — it is the authority on gamer tags
    // and on password strength, and paraphrasing it would hide the real reason.
    setStatus(detailStatus, messageFor(error), 'error');
    setDetailsEnabled(true);
  }
}

async function confirmCode() {
  if (confirmBtn.disabled) return;

  clearFieldError(codeField);
  const code = codeField.input.value.trim();

  if (!/^\d{6}$/.test(code)) {
    showFieldError(codeField, 'Enter the 6-digit code from your email.');
    return;
  }

  setCodeEnabled(false);
  setStatus(codeStatus, 'Checking your code…');

  try {
    await confirmSignUpCode(pendingEmail, code);
    setStatus(codeStatus, 'Your account is ready. You are signed in.', 'ok');
    await cacheProfileQuietly();
    codeActions.appendChild(el('a', {
      className: 'pagebtn', text: 'Go to your account', attrs: { href: '../' }
    }));
    confirmBtn.hidden = true;
  } catch (error) {
    setStatus(codeStatus, messageFor(error), 'error');
    setCodeEnabled(true);
  }
}

/**
 * Fills the local display cache so the hub and the game HUD can greet the
 * player without the SDK.
 *
 * Swallows its own failure by design: the account exists either way, and
 * turning "we could not read the profile row back" into a visible error on a
 * screen that just said "your account is ready" would be worse than a missing
 * greeting. auth.js deliberately never writes this cache itself.
 */
async function cacheProfileQuietly() {
  try {
    const profile = await getProfile();
    if (profile && typeof profile.gamer_tag === 'string' && profile.gamer_tag) {
      setCachedProfile({ gamerTag: profile.gamer_tag });
    }
  } catch (error) {
    console.error('Signed in, but could not cache the profile for display', error);
  }
}

function doneActions() {
  const actions = el('div', { className: 'actions' });
  actions.appendChild(el('a', {
    className: 'pagebtn', text: 'Go to your account', attrs: { href: '../' }
  }));
  return actions;
}

on(createBtn, 'click', createAccount);
on(confirmBtn, 'click', confirmCode);

submitOnEnter(emailField.input, createAccount);
submitOnEnter(tagField.input, createAccount);
submitOnEnter(passwordField.input, createAccount);
submitOnEnter(codeField.input, confirmCode);
