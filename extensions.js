// An optional extension hook. A site can name one same-origin script in
// EXTENSION_SCRIPT_URL; /api/me passes it on and this file loads it once.
// That script may swap the limit dialog for its own, listen for the
// 'limit-reached' event, and add its own items to the header slot. With no
// script set, nothing is fetched and the neutral dialog in limits.js is all
// anyone sees.
(function exposeSiteExtensions(root) {
  'use strict';

  const HOOK_VERSION = 1;
  const ANSWER_DELETE = 'delete';
  const ANSWER_OK = 'ok';
  const HEADER_SLOT_ID = 'header-slot';

  let limitDialog = null;
  const loadedUrls = new Set();

  function setLimitDialog(dialog) {
    limitDialog = typeof dialog === 'function' ? dialog : null;
  }

  // A broken script must not break the page, so a failed load is only logged.
  function loadScript(url) {
    if (!url || loadedUrls.has(url)) return;
    loadedUrls.add(url);
    const tag = document.createElement('script');
    tag.src = url;
    tag.onerror = () => console.warn('Extension script did not load:', url);
    document.head.appendChild(tag);
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

  // /api/me can answer before this file runs, so the account already known
  // is checked now and every later sign-in through 'auth-checked'.
  function loadAccountScript() {
    const user = root.currentUser;
    if (user) loadScript(user.extension_script_url);
  }

  root.siteExtensions = {
    version: HOOK_VERSION, setLimitDialog, loadScript, runLimitDialog, headerSlot,
  };
  document.addEventListener('auth-checked', loadAccountScript);
  loadAccountScript();
})(this);
