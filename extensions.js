// An optional extension hook. A site can name one same-origin script in
// EXTENSION_SCRIPT_URL; /api/me passes it on and this file loads it once.
// That script may swap the limit dialog for its own, listen for the
// 'limit-reached' event, add its own items to the header, sidebar, rail and
// account menu slots, and replace the links in the fine print slots. It may
// also read, open and replace the open page, and hear 'page-changed' on
// document when another page is on screen, and show any text read-only in
// the editor's place, and keep a signed-in visit's splash up until its items
// are in. It may also set what the Invite button offers, and ask whether the
// phone start screen is up, hearing 'hub-shown' and 'hub-hidden' on document
// as it comes and goes. With no script set, nothing is fetched and the
// neutral dialog in limits.js is all anyone sees.
(function exposeSiteExtensions(root) {
  'use strict';

  const HOOK_VERSION = 7;
  const ACCOUNT_LEGAL_SLOT_ID = 'account-legal-slot';
  const ACCOUNT_MENU_SLOT_ID = 'account-menu-slot';
  const ANSWER_DELETE = 'delete';
  const ANSWER_OK = 'ok';
  const AUTH_FINE_PRINT_SLOT_ID = 'auth-fine-print-slot';
  const HEADER_SLOT_ID = 'header-slot';
  const RAIL_SLOT_ID = 'rail-slot';
  const SIDEBAR_FOOT_SLOT_ID = 'sidebar-foot-slot';
  const SIDEBAR_SLOT_ID = 'sidebar-slot';
  const REASON_INVALID = 'invalid';
  const REASON_NOT_READY = 'not-ready';
  const REASON_OFFLINE = 'offline';
  const INVITE_TEXT_KEYS = Object.freeze(
    ['howItWorks', 'joined', 'allJoined', 'welcome', 'saveToEarn', 'earned']);

  let limitDialog = null;
  const loadedUrls = new Set();
  // Script loads and holds the splash (splash.js) waits for. Each settles,
  // never rejects, so one failure cannot keep the page covered.
  const pendingWork = [];

  function setLimitDialog(dialog) {
    limitDialog = typeof dialog === 'function' ? dialog : null;
  }

  // A broken script must not break the page, so a failed load is only logged.
  function loadScript(url) {
    if (!url || loadedUrls.has(url)) return;
    loadedUrls.add(url);
    const tag = document.createElement('script');
    tag.src = url;
    pendingWork.push(new Promise(done => {
      tag.onload = done;
      tag.onerror = () => {
        console.warn('Extension script did not load:', url);
        done();
      };
    }));
    document.head.appendChild(tag);
  }

  // A script that fills its slots after an await of its own calls this as it
  // runs, so its items appear with the page. The splash lifts after a few
  // seconds whatever happens.
  function holdSplash(work) {
    pendingWork.push(Promise.resolve(work).catch(error => {
      console.warn('Extension hook: work held for the splash failed:', error);
    }));
  }

  // Waits again when a settled load added more work, such as a second script.
  async function whenSettled() {
    let seen = -1;
    while (seen !== pendingWork.length) {
      seen = pendingWork.length;
      await Promise.all(pendingWork);
    }
  }

  // The swapped dialog's answer, or null to show the neutral one: when none
  // is set, or when it throws or rejects.
  async function runLimitDialog(detail) {
    if (!limitDialog) return null;
    try {
      return await limitDialog(detail) === ANSWER_DELETE ? ANSWER_DELETE : ANSWER_OK;
    } catch (error) {
      console.warn('Extension limit dialog failed:', error);
      return null;
    }
  }

  // The header's spot left of the account, for the script's own buttons.
  // It shows only while signed in and once something is in it.
  function headerSlot() {
    return document.getElementById(HEADER_SLOT_ID);
  }

  // The page's scripts give these functions: the open page's come from
  // storage.js's OpenPage. A page without them (a script that did not load)
  // answers each call as refused rather than throwing.
  function pageFunction(name, owner = root) {
    const found = owner ? owner[name] : undefined;
    if (typeof found === 'function') return found;
    console.warn('Extension hook: the open page is not available here:', name);
    return null;
  }

  // The fine print links: in the sign-in dialog, at the foot of the
  // notebook (shown only signed out), and on the account menu's Legal page.
  // Each holds the Privacy link until a script adds to it or replaces it.
  function authFinePrintSlot() {
    return document.getElementById(AUTH_FINE_PRINT_SLOT_ID);
  }

  function accountLegalSlot() {
    return document.getElementById(ACCOUNT_LEGAL_SLOT_ID);
  }

  function sidebarFootSlot() {
    return document.getElementById(SIDEBAR_FOOT_SLOT_ID);
  }

  // A spot under the notebook's pages for the script's own sidebar items,
  // and its twin at the foot of the folded sidebar, for icon buttons. Both
  // show signed in or out; the script decides what fits each.
  function sidebarSlot() {
    return document.getElementById(SIDEBAR_SLOT_ID);
  }

  function railSlot() {
    return document.getElementById(RAIL_SLOT_ID);
  }

  // A group in the account menu for the script's own items. Empty, it takes
  // no room.
  function accountMenuSlot() {
    return document.getElementById(ACCOUNT_MENU_SLOT_ID);
  }

  function currentPage() {
    const summary = pageFunction('summary', root.OpenPage);
    return summary ? summary() : null;
  }

  async function openPage(id) {
    if (typeof id !== 'string' || !id) {
      console.warn('Extension hook: openPage needs a page id.');
      return false;
    }
    const open = pageFunction('openById', root.OpenPage);
    if (!open) return false;
    try {
      return await open(id);
    } catch (error) {
      console.warn('Extension hook: openPage failed:', error);
      return false;
    }
  }

  async function replacePage(input) {
    const words = root.SlotInputs ? root.SlotInputs.readWords(input) : null;
    if (!words) {
      console.warn('Extension hook: replacePage was given words it cannot use.');
      return { ok: false, reason: REASON_INVALID };
    }
    const replace = pageFunction('replaceWhole', root.OpenPage);
    if (!replace) return { ok: false, reason: REASON_NOT_READY };
    try {
      return await replace(words);
    } catch (error) {
      console.warn('Extension hook: replacePage failed:', error);
      return { ok: false, reason: REASON_OFFLINE };
    }
  }

  function openSidePanel(element) {
    if (!(element instanceof Element)) {
      console.warn('Extension hook: openSidePanel needs an element.');
      return false;
    }
    if (!root.SidePanel) {
      console.warn('Extension hook: the side panel is not available here.');
      return false;
    }
    return root.SidePanel.open(element);
  }

  function closeSidePanel() {
    if (root.SidePanel) root.SidePanel.close();
  }

  function showPreview(input) {
    const read = root.SlotInputs ? root.SlotInputs.readPreview(input) : null;
    if (!read) {
      console.warn('Extension hook: showPreview was given values it cannot use.');
      return false;
    }
    if (!root.PagePreview) {
      console.warn('Extension hook: the preview is not available here.');
      return false;
    }
    return root.PagePreview.show(read);
  }

  function closePreview() {
    if (root.PagePreview) root.PagePreview.close();
  }

  const PAGE_ACTIONS_ID = 'page-actions';
  const NOTEBOOK_ACTIONS_EVENT = 'notebook-actions-changed';
  const ICON_CLASS = 'tip-btn-icon';
  const rowActions = [];

  function readAction(action) {
    const read = root.SlotInputs ? root.SlotInputs.readAction(action) : null;
    if (!read) console.warn('Extension hook: an action was given values it cannot use.');
    return read;
  }

  // The span shows only while signed in and holding a button, so a page with
  // no extension script never shows an empty gap.
  function showPageActions() {
    const span = document.getElementById(PAGE_ACTIONS_ID);
    if (!span) return;
    span.hidden = !(root.currentUser && span.childElementCount > 0);
  }

  function buildPageActionButton({ label, icon, onClick }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle-btn tip-btn tip-pill page-action-btn';
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    const svg = button.querySelector('svg');
    if (svg) svg.classList.add(ICON_CLASS);
    const text = document.createElement('span');
    text.className = 'tip-btn-label';
    text.textContent = label;
    button.appendChild(text);
    button.addEventListener('click', () => {
      try {
        onClick(currentPage());
      } catch (error) {
        console.warn('Extension hook: a page action failed:', error);
      }
    });
    return button;
  }

  function addPageAction(action) {
    const read = readAction(action);
    const span = document.getElementById(PAGE_ACTIONS_ID);
    if (!read || !span) return null;
    const button = buildPageActionButton(read);
    span.appendChild(button);
    showPageActions();
    return function remove() {
      button.remove();
      showPageActions();
    };
  }

  function announceNotebookActions() {
    document.dispatchEvent(new Event(NOTEBOOK_ACTIONS_EVENT));
  }

  function addNotebookRowAction(action) {
    const read = readAction(action);
    if (!read) return null;
    rowActions.push(read);
    announceNotebookActions();
    return function remove() {
      const at = rowActions.indexOf(read);
      if (at === -1) return;
      rowActions.splice(at, 1);
      announceNotebookActions();
    };
  }

  function notebookRowActions() {
    return rowActions.slice();
  }

  // /api/me can answer before this file runs, so the answer already known is
  // checked now and every later one through 'auth-checked'. Signed out, the
  // path comes from the 401's answer instead of the account.
  function loadAccountScript() {
    const user = root.currentUser;
    loadScript(user ? user.extension_script_url : root.signedOutScriptUrl);
  }

  // The note sits above the invite field, so the share dialog owns when it
  // shows; this only checks the text and passes it on.
  function addShareNote(text) {
    const note = root.SlotInputs ? root.SlotInputs.readNote(text) : null;
    if (note === null) {
      console.warn('Extension hook: addShareNote needs a string of 200 characters or fewer.');
      return;
    }
    const setNote = pageFunction('setShareNote');
    if (setNote) setNote(note);
  }

  // Only the known words, each a string or a function that returns one; a
  // missing one keeps the page-based words.
  function readInviteText(text) {
    const read = {};
    for (const key of INVITE_TEXT_KEYS) {
      const value = text ? text[key] : undefined;
      if (typeof value === 'string' || typeof value === 'function') read[key] = value;
      else if (value !== undefined) console.warn('Extension hook: invite text needs a string:', key);
    }
    return read;
  }

  // isAlwaysShown keeps the Invite button on for every signed-in account,
  // even with no page limit. friend-invite.js owns the button and its window.
  function setInviteOffer(offer) {
    const setOffer = pageFunction('setInviteOffer');
    if (!setOffer) return;
    const isObject = offer !== null && typeof offer === 'object';
    setOffer(isObject ? {
      isAlwaysShown: offer.isAlwaysShown === true,
      text: readInviteText(offer.text),
    } : null);
  }

  // hub.js gives this; a page without it never shows the start screen.
  function isHubShowing() {
    const isShowing = pageFunction('isHubShowing');
    return isShowing ? isShowing() === true : false;
  }

  root.siteExtensions = {
    version: HOOK_VERSION,
    setLimitDialog,
    loadScript,
    runLimitDialog,
    headerSlot,
    authFinePrintSlot,
    accountLegalSlot,
    sidebarFootSlot,
    sidebarSlot,
    railSlot,
    accountMenuSlot,
    currentPage,
    openPage,
    replacePage,
    openSidePanel,
    closeSidePanel,
    showPreview,
    closePreview,
    addPageAction,
    addNotebookRowAction,
    notebookRowActions,
    addShareNote,
    setInviteOffer,
    isHubShowing,
    holdSplash,
    whenSettled,
  };
  document.addEventListener('auth-checked', loadAccountScript);
  document.addEventListener('auth-checked', showPageActions);
  document.addEventListener('page-changed', showPageActions);
  loadAccountScript();
})(globalThis);
