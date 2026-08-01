/**
 * Account page. Signed out it is a sign-in card; signed in it is the profile,
 * sign-out, and account deletion behind a real confirmation.
 *
 * Page-module idiom, the same as js/games/snake/pages/leaderboard.js: no
 * exported init, no DOMContentLoaded, top-level side effects against a mount
 * point the document already contains.
 *
 * The three constraints that do not announce themselves at runtime: no <form>
 * (every page ships `form-action 'none'`, so Enter is wired by hand), no inline
 * style attributes (`style-src 'self'` drops them silently), and no innerHTML.
 *
 * Nothing here treats a local session as proof of identity. getSession() only
 * reports that this browser holds a token; the server re-derives the user from
 * the JWT on every request, and the delete-account function takes no user id
 * for exactly that reason.
 */

import { el, qs, on, setText, clear } from '../../shared/util/dom.js';
import { createA11y } from '../../shared/ui/a11y.js';
import {
  getSession, getProfile, signIn, signOut, deleteAccount
} from '../../shared/net/auth.js';
import { setCachedProfile, clearCachedProfile } from '../../shared/account/session.js';

const root = qs('#account-root');
const a11y = createA11y({ liveRegion: qs('#account-live') });

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

/** Locale-formatted join date, or null when the row has no usable timestamp. */
function memberSince(createdAt) {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/* --- Signed out ------------------------------------------------------------ */

function renderSignedOut(notice) {
  clear(root);

  const section = card(
    'Sign in',
    'Use the email address and password you signed up with. Gamer tags are not '
    + 'sign-in names.'
  );

  // Carried over from a sign-out or a deletion, and announced once.
  if (notice) {
    section.appendChild(el('p', { className: 'status status--ok', text: notice }));
    a11y.announce(notice);
  }

  const status = el('p', { className: 'status' });

  const emailField = field({
    id: 'signin-email',
    label: 'Email address',
    type: 'email',
    autocomplete: 'email',
    attrs: { autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }
  });

  const passwordField = field({
    id: 'signin-password',
    label: 'Password',
    type: 'password',
    autocomplete: 'current-password'
  });

  const fields = el('div', { className: 'fields' });
  fields.appendChild(emailField.wrap);
  fields.appendChild(passwordField.wrap);
  section.appendChild(fields);
  section.appendChild(status);

  const signInBtn = el('button', {
    text: 'Sign in', className: 'btn', attrs: { type: 'button' }
  });
  const actions = el('div', { className: 'actions' });
  actions.appendChild(signInBtn);
  actions.appendChild(el('a', {
    className: 'link', text: 'Create an account', attrs: { href: 'create/' }
  }));
  actions.appendChild(el('a', {
    className: 'link', text: 'Forgot your password?', attrs: { href: 'reset/' }
  }));
  section.appendChild(actions);

  function setEnabled(enabled) {
    signInBtn.disabled = !enabled;
    emailField.input.disabled = !enabled;
    passwordField.input.disabled = !enabled;
  }

  async function submit() {
    // A click and an Enter can both arrive; disabled is the latch.
    if (signInBtn.disabled) return;

    clearFieldError(emailField);
    clearFieldError(passwordField);

    const email = emailField.input.value.trim();
    const password = passwordField.input.value;

    if (!email) {
      showFieldError(emailField, 'Enter the email address on your account.');
      return;
    }
    if (!password) {
      showFieldError(passwordField, 'Enter your password.');
      return;
    }

    setEnabled(false);
    setStatus(status, 'Signing in…');

    try {
      await signIn(email, password);
      setStatus(status, 'Signed in.', 'ok');
      await renderFromSession();
    } catch (error) {
      // Supabase returns one message for a wrong password and an unknown
      // address, deliberately. Showing it verbatim keeps it that way.
      setStatus(status, messageFor(error), 'error');
      setEnabled(true);
    }
  }

  on(signInBtn, 'click', submit);
  submitOnEnter(emailField.input, submit);
  submitOnEnter(passwordField.input, submit);

  root.appendChild(section);
}

/* --- Signed in ------------------------------------------------------------- */

function renderSignedIn(profile) {
  clear(root);

  const tag = profile && typeof profile.gamer_tag === 'string' ? profile.gamer_tag : '';
  const joined = profile ? memberSince(profile.created_at) : null;

  const section = card('You are signed in');

  const list = el('dl', { className: 'profile' });

  const tagBlock = el('div');
  tagBlock.appendChild(el('dt', { className: 'profile__key', text: 'Gamer tag' }));
  tagBlock.appendChild(el('dd', {
    className: 'profile__value profile__value--tag',
    text: tag || 'Not set yet'
  }));
  list.appendChild(tagBlock);

  const sinceBlock = el('div');
  sinceBlock.appendChild(el('dt', { className: 'profile__key', text: 'Member since' }));
  sinceBlock.appendChild(el('dd', {
    className: 'profile__value',
    text: joined || 'Unknown'
  }));
  list.appendChild(sinceBlock);

  section.appendChild(list);

  if (!tag) {
    // auth.js returns null rather than throwing for a missing profiles row,
    // because zero rows is a state that genuinely happens — between the auth
    // user being created and the trigger inserting the profile. Say so instead
    // of rendering a blank name.
    section.appendChild(el('p', {
      className: 'card__lead',
      text: 'We could not find your player profile yet. If this does not sort '
        + 'itself out after a reload, sign out and sign in again.'
    }));
  }

  const status = el('p', { className: 'status' });
  section.appendChild(status);

  const signOutBtn = el('button', {
    text: 'Sign out', className: 'btn btn--ghost', attrs: { type: 'button' }
  });
  const actions = el('div', { className: 'actions' });
  actions.appendChild(signOutBtn);
  section.appendChild(actions);

  on(signOutBtn, 'click', async () => {
    if (signOutBtn.disabled) return;
    signOutBtn.disabled = true;
    setStatus(status, 'Signing out…');

    try {
      await signOut();
      // auth.js will not touch the display cache — net/ stays network-only —
      // so clearing it is this layer's job, and skipping it would leave the hub
      // greeting a player who has left.
      clearCachedProfile();
      renderSignedOut('You are signed out.');
    } catch (error) {
      setStatus(status, messageFor(error), 'error');
      signOutBtn.disabled = false;
    }
  });

  section.appendChild(deleteBlock(tag));

  root.appendChild(section);
}

/**
 * Deleting is destructive and irreversible, so the confirmation is a real one:
 * a second step that only appears on request, and inside it the player has to
 * type their own gamer tag before the button will do anything. One stray tap
 * cannot get through both.
 */
function deleteBlock(tag) {
  const wrap = el('div', { className: 'danger' });
  wrap.appendChild(el('h3', { className: 'danger__title', text: 'Delete your account' }));
  wrap.appendChild(el('p', {
    className: 'card__lead',
    text: 'This deletes your account and the email address stored with it. Your '
      + 'gamer tag is released and someone else may claim it. Scores already on '
      + 'the leaderboard are not yours to reclaim afterwards. This cannot be '
      + 'undone.'
  }));

  const startBtn = el('button', {
    text: 'Delete account…', className: 'btn btn--danger', attrs: { type: 'button' }
  });
  const startActions = el('div', { className: 'actions' });
  startActions.appendChild(startBtn);
  wrap.appendChild(startActions);

  const confirm = el('div', { className: 'danger__confirm' });
  confirm.hidden = true;

  // With no profile row there is no tag to type back, so fall back to a word
  // that is equally deliberate to type.
  const phrase = tag || 'DELETE';

  const confirmField = field({
    id: 'delete-confirm',
    label: `Type ${phrase} to confirm`,
    type: 'text',
    autocomplete: 'off',
    attrs: { autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }
  });

  const confirmFields = el('div', { className: 'fields' });
  confirmFields.appendChild(confirmField.wrap);
  confirm.appendChild(confirmFields);

  const status = el('p', { className: 'status' });
  confirm.appendChild(status);

  const deleteBtn = el('button', {
    text: 'Permanently delete my account', className: 'btn btn--danger', attrs: { type: 'button' }
  });
  deleteBtn.disabled = true;

  const cancelBtn = el('button', {
    text: 'Cancel', className: 'btn btn--ghost', attrs: { type: 'button' }
  });

  const confirmActions = el('div', { className: 'actions' });
  confirmActions.appendChild(deleteBtn);
  confirmActions.appendChild(cancelBtn);
  confirm.appendChild(confirmActions);
  wrap.appendChild(confirm);

  const matches = () =>
    confirmField.input.value.trim().toLowerCase() === phrase.toLowerCase();

  on(confirmField.input, 'input', () => {
    deleteBtn.disabled = !matches();
  });

  on(startBtn, 'click', () => {
    confirm.hidden = false;
    startBtn.hidden = true;
    confirmField.input.focus();
    a11y.announce(`Confirm deletion by typing ${phrase}.`);
  });

  on(cancelBtn, 'click', () => {
    confirm.hidden = true;
    startBtn.hidden = false;
    confirmField.input.value = '';
    deleteBtn.disabled = true;
    clearFieldError(confirmField);
    setStatus(status, '');
    startBtn.focus();
  });

  async function runDelete() {
    if (deleteBtn.disabled) return;
    if (!matches()) {
      showFieldError(confirmField, `Type ${phrase} exactly to confirm.`);
      return;
    }

    deleteBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmField.input.disabled = true;
    setStatus(status, 'Deleting your account…');

    try {
      await deleteAccount();

      // The local session survives the call and is now a token for a user that
      // no longer exists, so signing out is part of deleting — but a failure
      // here must not read as "the deletion failed", because it did not.
      try {
        await signOut();
      } catch (error) {
        console.error('Account deleted, but the local session did not clear', error);
      }
      clearCachedProfile();

      renderSignedOut('Your account and the email address stored with it have been deleted.');
    } catch (error) {
      setStatus(status, messageFor(error), 'error');
      deleteBtn.disabled = false;
      cancelBtn.disabled = false;
      confirmField.input.disabled = false;
    }
  }

  on(deleteBtn, 'click', runDelete);
  submitOnEnter(confirmField.input, runDelete);

  return wrap;
}

/* --- Boot ------------------------------------------------------------------ */

async function renderFromSession() {
  const session = await getSession();

  if (!session) {
    renderSignedOut();
    return;
  }

  const profile = await getProfile();

  if (profile && typeof profile.gamer_tag === 'string' && profile.gamer_tag) {
    // Keeps the hub greeting and the game HUD in step with the real profile.
    setCachedProfile({ gamerTag: profile.gamer_tag });
  }

  renderSignedIn(profile);
}

const loading = el('div', { className: 'empty', text: 'Checking your account…' });
root.appendChild(loading);

renderFromSession().catch((error) => {
  clear(root);
  const section = card('Account unavailable');
  section.appendChild(el('p', {
    className: 'status status--error',
    text: messageFor(error)
  }));
  section.appendChild(el('p', {
    className: 'card__lead',
    text: 'Reload the page to try again. You can still play every game without '
      + 'an account.'
  }));
  root.appendChild(section);
  a11y.announce('Your account could not be loaded.');
  console.error('Failed to load the account page', error);
});
