/**
 * Standalone high-scores page.
 *
 * Classes only, no inline style attributes: this page ships `style-src 'self'`
 * with no unsafe-inline, which governs style attributes too, so anything set
 * that way is dropped silently. The `.boards` / `.board` rules live in
 * css/pages.css.
 */

import { loadScores } from '../storage/scoresStore.js';
import { fetchTopScores } from '../../../shared/net/leaderboard.js';
import { el, qs } from '../../../shared/util/dom.js';
import { getSession } from '../../../shared/net/auth.js';
import { createReportLink } from '../../../shared/account/reportLink.js';
import { attachBadgeMarks } from '../../../shared/achievements/boardMarks.js';

const GAME_ID = 'tetris';

// Whether a report control is offered. Resolved before the global table is
// built, so the table never has to be re-rendered when the session lands.
// Reporting requires a session; the Edge Function rejects an unauthenticated
// caller before it looks anything up, so offering the control signed-out would
// only produce a guaranteed failure.
let signedIn = false;

const root = qs('#scores-root');
const boards = el('div', { className: 'boards' });
root.appendChild(boards);

function renderTable(scores, isGlobal, markAnchors = null) {
  const table = el('table', { className: 'scores' });

  const headers = isGlobal
    ? [['#', 'rank'], ['Player', ''], ['Score', 'num']]
    : [['#', 'rank'], ['Player', ''], ['Score', 'num'], ['Level', 'num'], ['Lines', 'num']];

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
      const tick = el('span', {
        className: 'scores__badge',
        text: '✓',
        attrs: { role: 'img', 'aria-label': 'Verified account' }
      });
      nameCell.appendChild(tick);
      // The achievement mark arrives in a second pass and slots in after the
      // tick, ahead of the report link. Global rows only: a local row's name is
      // whatever this browser stored and may belong to nobody at all.
      if (isGlobal && markAnchors) {
        const tag = entry.player_name;
        if (!markAnchors.has(tag)) markAnchors.set(tag, []);
        markAnchors.get(tag).push(tick);
      }
    }
    // Reporting requires a session, and only an owned gamer tag can be
    // reported — typed-in initials belong to nobody, so there is no account to
    // action. The link is offered rather than the form itself: a form per row
    // does not fit a table cell, and the report page can explain itself.
    if (isGlobal && entry.is_verified && signedIn) {
      nameCell.appendChild(createReportLink(entry.player_name));
    }
    tr.appendChild(nameCell);
    tr.appendChild(el('td', {
      text: Number(entry.score).toLocaleString(),
      className: 'num scores__score'
    }));

    if (!isGlobal) {
      tr.appendChild(el('td', { text: String(entry.level ?? '—'), className: 'num' }));
      tr.appendChild(el('td', { text: String(entry.lines ?? '—'), className: 'num' }));
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
const loading = el('div', { className: 'empty', text: 'Loading global top 10…' });
globalWrap.appendChild(loading);

Promise.all([
  fetchTopScores(GAME_ID),
  // A failed session lookup is not a failed page — fall back to "signed out",
  // which loses the report control and nothing else.
  getSession().catch(() => null)
]).then(([scores, session]) => {
  signedIn = Boolean(session);
  globalWrap.removeChild(loading);
  const markAnchors = new Map();
  globalWrap.appendChild(
    scores.length
      ? renderTable(scores, true, markAnchors)
      : el('div', { className: 'empty', text: 'No global scores yet.' })
  );
  // Second pass, deliberately not awaited: the table is already on screen and
  // the marks fill in behind it. See boardMarks.js.
  attachBadgeMarks(markAnchors);
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
    text: 'Failed to load global scores.'
  }));
  console.error(error);
});
