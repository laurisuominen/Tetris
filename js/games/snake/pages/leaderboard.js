/**
 * Standalone high-scores page.
 *
 * Classes only, no inline style attributes: this page ships `style-src 'self'`
 * with no unsafe-inline, which governs style attributes too.
 */

import { loadScores } from '../storage/scoresStore.js';
import { fetchTopScores } from '../../../shared/net/leaderboard.js';
import { el, qs } from '../../../shared/util/dom.js';
import { getSession } from '../../../shared/net/auth.js';
import { createReportControl } from '../../../shared/account/reportControl.js';

const GAME_ID = 'snake';

// Whether a report control is offered. Resolved before the global table is
// built, so the table never has to be re-rendered when the session lands.
// Reporting requires a session; the Edge Function rejects an unauthenticated
// caller before it looks anything up, so offering the control signed-out would
// only produce a guaranteed failure.
let signedIn = false;

const root = qs('#scores-root');
const boards = el('div', { className: 'boards' });
root.appendChild(boards);

function renderTable(scores, isGlobal) {
  const table = el('table', { className: 'scores' });

  const headers = isGlobal
    ? [['#', 'rank'], ['Player', ''], ['Score', 'num']]
    : [['#', 'rank'], ['Player', ''], ['Score', 'num'], ['Apples', 'num'], ['Length', 'num']];

  const head = el('tr');
  for (const [label, cls] of headers) head.appendChild(el('th', { text: label, className: cls }));
  const thead = el('thead');
  thead.appendChild(head);
  table.appendChild(thead);

  const body = el('tbody');
  scores.forEach((entry, i) => {
    const tr = el('tr');
    tr.appendChild(el('td', { text: String(i + 1), className: 'rank' }));
    // Both boards mark an owned gamer tag; only the source of the flag
    // differs — the database column globally, the stored row locally.
    const verified = isGlobal ? Boolean(entry.is_verified) : entry.verified === true;
    const nameCell = el('td', {
      text: isGlobal ? entry.player_name : (entry.name || '—'),
      // An owned tag is up to 15 characters; the wide tracking below is tuned
      // for three, and at that length it pushes the table wider than a phone.
      className: verified ? 'initials initials--tag' : 'initials'
    });
    if (verified) {
      // role="img" plus a label: a bare tick is read as punctuation or skipped,
      // and the distinction between an owned gamer tag and typed-in initials is
      // the entire point of showing it.
      nameCell.appendChild(el('span', {
        className: 'scores__badge',
        text: '✓',
        attrs: { role: 'img', 'aria-label': 'Verified account' }
      }));
    }
    // Reporting requires a session, and only an owned gamer tag can be
    // reported — typed-in initials belong to nobody, so there is no account to
    // action. The control is added asynchronously because the session check is
    // async and the table renders synchronously.
    if (isGlobal && entry.is_verified && signedIn) {
      nameCell.appendChild(createReportControl(entry.player_name));
    }
    tr.appendChild(nameCell);
    tr.appendChild(el('td', {
      text: Number(entry.score).toLocaleString(),
      className: 'num scores__score'
    }));

    if (!isGlobal) {
      tr.appendChild(el('td', { text: String(entry.apples ?? '—'), className: 'num' }));
      tr.appendChild(el('td', { text: String(entry.length ?? '—'), className: 'num' }));
    }
    body.appendChild(tr);
  });
  table.appendChild(body);

  return table;
}

function board(title) {
  const wrap = el('div', { className: 'board' });
  wrap.appendChild(el('h2', { className: 'board__title', text: title }));
  boards.appendChild(wrap);
  return wrap;
}

/* Local — always available, so it renders first and synchronously. */
const localWrap = board('Local — this browser');
const localScores = loadScores().slice().sort((a, b) => b.score - a.score).slice(0, 10);
localWrap.appendChild(
  localScores.length
    ? renderTable(localScores, false)
    : el('div', { className: 'empty', text: 'No scores yet — go play a game.' })
);

/* Global — network, so it announces its own state rather than sitting blank. */
const globalWrap = board('Global — top 10');
const loading = el('div', { className: 'empty', text: 'Loading global scores…' });
globalWrap.appendChild(loading);

Promise.all([
  fetchTopScores(GAME_ID),
  // A failed session lookup is not a failed page — fall back to "signed out",
  // which loses the report control and nothing else.
  getSession().catch(() => null)
]).then(([scores, session]) => {
  signedIn = Boolean(session);
  globalWrap.removeChild(loading);
  globalWrap.appendChild(
    scores.length
      ? renderTable(scores, true)
      : el('div', { className: 'empty', text: 'No global scores yet.' })
  );
  // Say the rule out loud. A player whose fourth-best run does not appear would
  // otherwise read a working cap as a failed submission.
  if (scores.length) {
    globalWrap.appendChild(el('p', {
      className: 'board__note',
      text: 'Each player’s best 3 scores, so one player cannot hold the board.'
    }));
  }
}).catch((error) => {
  globalWrap.removeChild(loading);
  globalWrap.appendChild(el('div', {
    className: 'empty',
    text: 'Could not load global scores.'
  }));
  console.error('Failed to load global leaderboard', error);
});
