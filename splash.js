// A signed-in visit opens on the logo and fades into the page once the
// notebook, the rhymes and any extension items are in, so they arrive
// together instead of one at a time. The session cookie cannot be read from
// here, so a note left at sign-in says who gets it. This runs in the head,
// before the page is drawn, and catches 'auth-checked' however early it comes.
(function showSplashUntilReady(root) {
  'use strict';

  const SIGNED_IN_HINT_KEY = 'signed_in_hint';
  const SPLASH_CLASS = 'is-splashing';
  const FADING_CLASS = 'is-splash-fading';
  const NOTEBOOK_OPENED_EVENT = 'notebook-opened';
  const LIFTED_EVENT = 'splash-lifted';
  // Counted from when the page was requested.
  const MIN_SHOW_MS = 600;
  const MAX_SHOW_MS = 3000;
  // Matches --duration-slow, the fade in styles.css.
  const FADE_MS = 280;

  // auth.js calls this with every sign-in answer.
  function rememberSignedIn(isSignedIn) {
    try {
      if (isSignedIn) localStorage.setItem(SIGNED_IN_HINT_KEY, '1');
      else localStorage.removeItem(SIGNED_IN_HINT_KEY);
    } catch {}
  }

  function wasSignedIn() {
    try {
      return localStorage.getItem(SIGNED_IN_HINT_KEY) === '1';
    } catch {
      return false;
    }
  }

  function nextEvent(name) {
    return new Promise(done => document.addEventListener(name, done, { once: true }));
  }

  function waitUntil(ms) {
    return new Promise(done => setTimeout(done, Math.max(0, ms - performance.now())));
  }

  // Lets the last render reach the screen before the logo lifts.
  function nextPaint() {
    return new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  }

  function rhymesSettled() {
    return typeof root.rhymeDataSettled === 'function' ? root.rhymeDataSettled() : null;
  }

  function extensionsSettled() {
    const hooks = root.siteExtensions;
    return hooks && typeof hooks.whenSettled === 'function' ? hooks.whenSettled() : null;
  }

  async function whenPageReady(authChecked, notebookOpened, scriptsReady) {
    await Promise.all([authChecked, scriptsReady]);
    if (!root.currentUser) return;
    await Promise.all([notebookOpened, rhymesSettled(), extensionsSettled(), document.fonts.ready]);
  }

  function reveal() {
    const html = document.documentElement;
    if (!html.classList.contains(SPLASH_CLASS) || html.classList.contains(FADING_CLASS)) return;
    html.classList.add(FADING_CLASS);
    document.dispatchEvent(new Event(LIFTED_EVENT));
    setTimeout(() => html.classList.remove(SPLASH_CLASS, FADING_CLASS), FADE_MS);
  }

  function startSplash() {
    document.documentElement.classList.add(SPLASH_CLASS);
    const authChecked = nextEvent('auth-checked');
    const notebookOpened = nextEvent(NOTEBOOK_OPENED_EVENT);
    const scriptsReady = nextEvent('DOMContentLoaded');
    const ready = whenPageReady(authChecked, notebookOpened, scriptsReady);
    Promise.all([ready, waitUntil(MIN_SHOW_MS)]).then(nextPaint).then(reveal, reveal);
    waitUntil(MAX_SHOW_MS).then(reveal);
  }

  root.rememberSignedIn = rememberSignedIn;
  if (wasSignedIn()) startSplash();
})(this);
