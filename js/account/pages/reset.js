/**
 * Password-reset page: ask for a code by email, then set a new password with it.
 *
 * Page-module idiom, the same as js/games/snake/pages/leaderboard.js: no
 * exported init, no DOMContentLoaded, top-level side effects against a mount
 * point the document already contains.
 *
 * The three constraints that do not announce themselves at runtime: no <form>
 * (every page ships `form-action 'none'`, so Enter is wired by hand), no inline
 * style attributes (`style-src 'self'` drops them silently), and no innerHTML.
 *
 * One wording rule, and it is not cosmetic: requesting a reset resolves whether
 * or not the address has an account, because Supabase will not confirm which
 * addresses are registered. "Check your inbox" would claim something this page
 * cannot know, so it says "if that address has an account".
 */

import { el, qs, on, setText } from '../../shared/util/dom.js';
import { createA11y } from '../../shared/ui/a11y.js';
import { requestPasswordReset, confirmPasswordReset, getProfile } from '../../shared/net/auth.js';
import { setCachedProfile } from '../../shared/account/session.js';

const root = qs('#reset-root');
const a11y = createA11y({ liveRegion: qs('#reset-live') });

/* From supabase/config.toml (minimum_password_length = 8). A courtesy check;
   the server is what enforces it. */
const MIN_PASSWORD = 8;

const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function messageFor(error) {
  const message = error && typeof error.message === 'string' ? error.message.trim() : '';
  return message || 'Something went wrong. Please check your connection and try again.';
}

/* --- Builders (local to the page on purpose; see create.js) ---------------- */

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

function submitOnEnter(input, handler) {
  on(input, 'keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    handler();
  });
}

/* --- Step 1: request a code ----------------------------------------------- */

const requestCard = card('Request a code');

const emailField = field({
  id: 'reset-email',
  label: 'Email address',
  type: 'email',
  autocomplete: 'email',
  attrs: { autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }
});

const requestFields = el('div', { className: 'fields' });
requestFields.appendChild(emailField.wrap);
requestCard.appendChild(requestFields);

const requestStatus = el('p', { className: 'status' });
requestCard.appendChild(requestStatus);

const requestBtn = el('button', {
  text: 'Send me a code', className: 'btn', attrs: { type: 'button' }
});
const requestActions = el('div', { className: 'actions' });
requestActions.appendChild(requestBtn);
requestCard.appendChild(requestActions);

/* --- Step 2: code plus the new password ------------------------------------ */

const codeCard = card('Set a new password');
codeCard.hidden = true;

const codeLead = el('p', { className: 'card__lead' });
codeCard.appendChild(codeLead);

const codeField = field({
  id: 'reset-code',
  label: '6-digit code',
  type: 'text',
  autocomplete: 'one-time-code',
  className: 'field__input--code',
  hint: 'From the reset email. It expires in an hour.',
  attrs: { inputmode: 'numeric', maxlength: '6' }
});

const passwordField = field({
  id: 'reset-password',
  label: 'New password',
  type: 'password',
  autocomplete: 'new-password',
  hint: `At least ${MIN_PASSWORD} characters.`
});

const codeFields = el('div', { className: 'fields' });
codeFields.appendChild(codeField.wrap);
codeFields.appendChild(passwordField.wrap);
codeCard.appendChild(codeFields);

const codeStatus = el('p', { className: 'status' });
codeCard.appendChild(codeStatus);

const confirmBtn = el('button', {
  text: 'Set new password', className: 'btn', attrs: { type: 'button' }
});
const codeActions = el('div', { className: 'actions' });
codeActions.appendChild(confirmBtn);
codeCard.appendChild(codeActions);

root.appendChild(requestCard);
root.appendChild(codeCard);

/* --- Behaviour ------------------------------------------------------------- */

/* Held from step 1: verifyOtp needs the address as well as the code, and asking
   for it a second time is a way to get a mismatch. */
let pendingEmail = '';

function setRequestEnabled(enabled) {
  requestBtn.disabled = !enabled;
  emailField.input.disabled = !enabled;
}

function setCodeEnabled(enabled) {
  confirmBtn.disabled = !enabled;
  codeField.input.disabled = !enabled;
  passwordField.input.disabled = !enabled;
}

async function requestCode() {
  // A click and an Enter can both arrive; disabled is the latch that stops two
  // reset mails going out for one request.
  if (requestBtn.disabled) return;

  clearFieldError(emailField);
  const email = emailField.input.value.trim();

  if (!looksLikeEmail(email)) {
    showFieldError(emailField, 'Enter the email address on your account.');
    return;
  }

  setRequestEnabled(false);
  setStatus(requestStatus, 'Sending…');

  try {
    await requestPasswordReset(email);
    pendingEmail = email;

    setStatus(requestStatus, 'Request sent.', 'ok');
    setText(codeLead,
      `If ${email} has an account, a 6-digit code is on its way to it. Enter the `
      + 'code and the password you want to use from now on.');
    codeCard.hidden = false;
    a11y.announce('If that address has an account, a code is on its way. Enter it below.');
    codeField.input.focus();

    // Re-enabled on purpose: a mistyped address should be correctable without a
    // reload, and the request itself is idempotent from the player's side.
    setRequestEnabled(true);
  } catch (error) {
    setStatus(requestStatus, messageFor(error), 'error');
    setRequestEnabled(true);
  }
}

async function confirmReset() {
  if (confirmBtn.disabled) return;

  clearFieldError(codeField);
  clearFieldError(passwordField);

  const code = codeField.input.value.trim();
  const password = passwordField.input.value;

  if (!/^\d{6}$/.test(code)) {
    showFieldError(codeField, 'Enter the 6-digit code from your email.');
    return;
  }
  if (password.length < MIN_PASSWORD) {
    showFieldError(passwordField, `Passwords must be at least ${MIN_PASSWORD} characters.`);
    return;
  }

  setCodeEnabled(false);
  setStatus(codeStatus, 'Checking your code…');

  try {
    await confirmPasswordReset(pendingEmail, code, password);

    setStatus(codeStatus, 'Your password is set, and you are signed in.', 'ok');
    await cacheProfileQuietly();

    codeActions.appendChild(el('a', {
      className: 'pagebtn', text: 'Go to your account', attrs: { href: '../' }
    }));
    confirmBtn.hidden = true;
  } catch (error) {
    /*
     * confirmPasswordReset is two calls: verify the code, then set the
     * password. If the first succeeded and the second did not, the player is
     * now SIGNED IN with their OLD password — so this has to read as a failure
     * and say which password still works, rather than bouncing them somewhere
     * that looks like success.
     */
    setStatus(
      codeStatus,
      `${messageFor(error)} Your password has not been changed — the old one still works.`,
      'error'
    );
    setCodeEnabled(true);
  }
}

/**
 * Fills the local display cache so the hub can greet the player without the
 * SDK. Swallows its own failure: the password change succeeded either way, and
 * a missing greeting is a smaller harm than an error on a screen that just
 * reported success. auth.js deliberately never writes this cache itself.
 */
async function cacheProfileQuietly() {
  try {
    const profile = await getProfile();
    if (profile && typeof profile.gamer_tag === 'string' && profile.gamer_tag) {
      setCachedProfile({ gamerTag: profile.gamer_tag });
    }
  } catch (error) {
    console.error('Password reset succeeded, but the profile could not be cached', error);
  }
}

on(requestBtn, 'click', requestCode);
on(confirmBtn, 'click', confirmReset);

submitOnEnter(emailField.input, requestCode);
submitOnEnter(codeField.input, confirmReset);
submitOnEnter(passwordField.input, confirmReset);
