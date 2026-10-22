// The site's page and people limits, as the browser shows them: a quiet
// "3 of 5 pages" under the notebook, and a plain dialog at New page and Share
// when the next one would go over. The numbers come from /api/me. With no
// limits set (a self-hosted copy) none of this shows. The browser loads this
// as a plain script and reads window.SiteLimits; Node loads it with require.
(function exposeSiteLimits(root) {
  'use strict';

  const KIND_PAGES = 'pages';
  const KIND_PEOPLE = 'people';
  const ANSWER_DELETE = 'delete';
  const ANSWER_OK = 'ok';

  const DIALOGS = {
    [KIND_PAGES]: {
      heading: 'Page limit reached',
      message: "You've reached the page limit for this site.",
      confirmLabel: 'Delete a page',
      cancelLabel: 'OK',
    },
    [KIND_PEOPLE]: {
      heading: 'People limit reached',
      message: "You've reached the limit of people on one page for this site.",
      confirmLabel: 'OK',
      noCancel: true,
    },
  };

  // Kinds whose dialog this tab has shown while limits only report. A reload
  // starts fresh, which is fine: the dialog is a heads-up, not a gate.
  const shownThisTab = new Set();

  function hasLimit(limit) {
    return typeof limit === 'number';
  }

  // Always "pages": it reads "1 of 5 pages", never "1 of 5 page".
  function pageCountText(count, limit) {
    return hasLimit(limit) ? `${count} of ${limit} pages` : '';
  }

  // The same rule as the server's, so the dialog and a 402 agree.
  function isAtLimit(count, limit) {
    return hasLimit(limit) && count >= limit;
  }

  function limitFor(user, kind) {
    const limit = kind === KIND_PAGES ? user.page_limit : user.people_limit;
    return hasLimit(limit) ? limit : null;
  }

  async function showLimitDialog({ kind }) {
    const answer = await root.openDialog(DIALOGS[kind]);
    return kind === KIND_PAGES && answer === true ? ANSWER_DELETE : ANSWER_OK;
  }

  // Whether to go ahead with a new page or a new person. When limits are
  // enforced the server would refuse, so the dialog shows every time and the
  // answer is no. When they only report, the dialog shows once per tab and
  // the action goes ahead, unless they chose to delete a page instead.
  async function askAtLimit(kind, count) {
    const user = root.currentUser;
    if (!user) return true;
    const limit = limitFor(user, kind);
    if (!isAtLimit(count, limit)) return true;

    const isEnforced = user.limits_enforced === true;
    if (!isEnforced && shownThisTab.has(kind)) return true;
    shownThisTab.add(kind);

    const answer = await showLimitDialog({ kind, limit });
    if (answer === ANSWER_DELETE && typeof root.openLyricsList === 'function') root.openLyricsList();
    return !isEnforced && answer === ANSWER_OK;
  }

  const SiteLimits = { pageCountText, isAtLimit, askAtLimit, showLimitDialog };

  if (typeof module === 'object' && module.exports) {
    module.exports = SiteLimits;
  } else {
    root.SiteLimits = SiteLimits;
  }
})(this);
