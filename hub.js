// The phone start screen: the mark, "Your move." and two ways in, Notebook
// and Create. hub-gate.js decides at load whether this visit opens on it;
// this script puts it away once a way in is picked, and announces it coming
// and going so extension scripts can move what they keep in its top bar.
(function exposeHub() {
  'use strict';

  const HUB_CLASS = 'is-hub';
  const SHOWN_EVENT = 'hub-shown';
  const HIDDEN_EVENT = 'hub-hidden';
  const SIGNED_OUT_CHOICE = 'signed-out';
  const PHONE_QUERY = '(max-width: 768px)';
  const inviteButton = document.getElementById('invite-btn');
  // Where Invite sits off the start screen, beside Share above the words.
  const inviteHome = { parent: inviteButton.parentElement, next: inviteButton.nextSibling };

  function isHubShowing() {
    return document.documentElement.classList.contains(HUB_CLASS);
  }

  // The start screen's top bar is the header: Invite, the extension slot,
  // then Account. Off it, both go back where the editor keeps them.
  function placeTopBarControls() {
    if (isHubShowing()) {
      const slot = document.getElementById('header-slot');
      slot.parentElement.insertBefore(inviteButton, slot);
    } else {
      inviteHome.parent.insertBefore(inviteButton, inviteHome.next);
    }
    placeAccountMenu();
  }

  function showHub() {
    if (isHubShowing()) return;
    document.documentElement.classList.add(HUB_CLASS);
    placeTopBarControls();
    document.dispatchEvent(new Event(SHOWN_EVENT));
  }

  // Marking the tab keeps the start screen away when this tab reloads.
  function hideHub(choice) {
    if (!isHubShowing()) return;
    document.documentElement.classList.remove(HUB_CLASS);
    try {
      window.HubGate.markTab(window);
    } catch {
      // Storage refused; a reload here goes to the editor anyway (hub-gate.js).
    }
    placeTopBarControls();
    document.dispatchEvent(new Event(HIDDEN_EVENT));
    if (choice !== SIGNED_OUT_CHOICE) window.trackEvent('hub_choice', { choice });
  }

  function openNotebookFromHub() {
    hideHub('notebook');
    NotebookList.open();
  }

  function createFromHub() {
    hideHub('create');
    handleCreateClick();
  }

  // On a phone the notebook's wordmark leads back to the start screen in
  // place, so the page being written stays open behind it.
  function reopenHubFromWordmark(event) {
    if (!window.matchMedia(PHONE_QUERY).matches) return;
    if (!document.body.classList.contains('signed-in')) return;
    event.preventDefault();
    Sidebar.close();
    showHub();
  }

  // The splash only guesses who is signed in; when the guess was wrong the
  // start screen goes and the signed-out editor stays.
  function hideIfSignedOut() {
    if (window.currentUser === null) hideHub(SIGNED_OUT_CHOICE);
  }

  document.getElementById('hub-notebook-btn').addEventListener('click', openNotebookFromHub);
  document.getElementById('hub-create-btn').addEventListener('click', createFromHub);
  document.querySelector('.sidebar-wordmark').addEventListener('click', reopenHubFromWordmark);
  document.addEventListener('auth-checked', hideIfSignedOut);
  if (isHubShowing()) placeTopBarControls();

  window.isHubShowing = isHubShowing;
  window.showHub = showHub;
  window.hideHub = hideHub;
})();
