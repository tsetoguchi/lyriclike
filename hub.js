// The phone start screen: the mark, "Get started." and two ways in, Notebook
// and Create. hub-gate.js decides at load whether this visit opens on it;
// this script puts it away once a way in is picked, and announces it coming
// and going so extension scripts can move what they keep in its top bar.
(function exposeHub() {
  'use strict';

  const HUB_CLASS = 'is-hub';
  const SHOWN_EVENT = 'hub-shown';
  const HIDDEN_EVENT = 'hub-hidden';
  const SIGNED_OUT_CHOICE = 'signed-out';
  const NO_ANSWER_CHOICE = 'no-answer';
  const WIDE_SCREEN_CHOICE = 'wide-screen';
  // Ways the start screen leaves without the writer picking anything.
  const UNPICKED_CHOICES = new Set([SIGNED_OUT_CHOICE, NO_ANSWER_CHOICE, WIDE_SCREEN_CHOICE]);
  const SPLASH_CLASS = 'is-splashing';
  const SPLASH_FADING_CLASS = 'is-splash-fading';
  const SPLASH_LIFTED_EVENT = 'splash-lifted';
  const PHONE_QUERY = '(max-width: 768px)';
  const inviteButton = document.getElementById('invite-btn');
  // Where Invite sits off the start screen, beside Share above the words.
  const inviteHome = { parent: inviteButton.parentElement, next: inviteButton.nextSibling };

  function isHubShowing() {
    return document.documentElement.classList.contains(HUB_CLASS);
  }

  // The start screen's top bar is the header: Invite on the left, the
  // extension slot and Account on the right. Off it, both go back where the
  // editor keeps them.
  function placeTopBarControls() {
    if (isHubShowing()) {
      const header = document.querySelector('header');
      header.insertBefore(inviteButton, header.firstElementChild);
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
    if (!UNPICKED_CHOICES.has(choice)) window.trackEvent('hub_choice', { choice });
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

  function isSplashLifted() {
    const classes = document.documentElement.classList;
    return !classes.contains(SPLASH_CLASS) || classes.contains(SPLASH_FADING_CLASS);
  }

  // A sign-in check slower than the splash's time cap goes to the editor, so
  // the start screen never shows without the account it belongs to.
  function hideIfUnanswered() {
    if (window.currentUser === undefined) hideHub(NO_ANSWER_CHOICE);
  }

  // The start screen is phone only; a phone turned wide gets the editor, and
  // turning back keeps it.
  function hideIfWide(event) {
    if (!event.matches) hideHub(WIDE_SCREEN_CHOICE);
  }

  document.getElementById('hub-notebook-btn').addEventListener('click', openNotebookFromHub);
  document.getElementById('hub-create-btn').addEventListener('click', createFromHub);
  document.querySelector('.sidebar-wordmark').addEventListener('click', reopenHubFromWordmark);
  document.addEventListener('auth-checked', hideIfSignedOut);
  document.addEventListener(SPLASH_LIFTED_EVENT, hideIfUnanswered);
  window.matchMedia(PHONE_QUERY).addEventListener('change', hideIfWide);
  // Either answer can come before this script, which loads late in the body.
  hideIfSignedOut();
  if (isSplashLifted()) hideIfUnanswered();
  if (isHubShowing()) placeTopBarControls();

  window.isHubShowing = isHubShowing;
  window.showHub = showHub;
  window.hideHub = hideHub;
})();
