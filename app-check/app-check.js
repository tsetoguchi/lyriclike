// The security check for the iOS app. Turnstile runs only on http(s) pages and
// the iOS app's pages are capacitor://, so the app shows this page in a frame
// and gets the token back as a message. Only the iOS app's origin can receive it.
(function initAppCheck(root) {
  'use strict';

  const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  const APP_ORIGIN = 'capacitor://localhost';
  const MESSAGE_SOURCE = 'lyriclike-app-check';
  const WIDGET_SELECTOR = '#check';
  const ACTIONS = Object.freeze(['signup', 'forgot', 'login', 'lookup']);
  const SITE_KEY_PATTERN = /^[0-9A-Za-z_-]{1,100}$/;
  const BAD_REQUEST = 'bad-request';
  const SCRIPT_FAILED = 'script-failed';

  // Returns { siteKey, action }, or null when the address does not name both.
  function readCheckRequest(search) {
    const params = new URLSearchParams(search);
    const siteKey = params.get('sitekey') || '';
    const action = params.get('action') || '';
    if (!SITE_KEY_PATTERN.test(siteKey) || !ACTIONS.includes(action)) return null;
    return { siteKey, action };
  }

  // A browser that can't address the app's origin (Chromium calls custom
  // schemes opaque) throws; the page is then not in the app, so nothing is sent.
  function makeSender(target) {
    return (type, detail) => {
      try {
        target.postMessage({ source: MESSAGE_SOURCE, type, ...detail }, APP_ORIGIN);
      } catch {
        // Not inside the iOS app: there is no one to tell.
      }
    };
  }

  function widgetOptions(request, send) {
    return {
      sitekey: request.siteKey,
      action: request.action,
      appearance: 'interaction-only',
      theme: 'dark',
      size: 'flexible',
      callback: token => send('token', { token }),
      'error-callback': code => send('error', { code: String(code) }),
      'expired-callback': () => send('expired'),
      'before-interactive-callback': () => send('show'),
      'after-interactive-callback': () => send('hide'),
    };
  }

  function loadTurnstileScript(document) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = TURNSTILE_SCRIPT_URL;
      tag.async = true;
      tag.addEventListener('load', () => resolve(root.turnstile));
      tag.addEventListener('error', () => reject(new Error(SCRIPT_FAILED)));
      document.head.appendChild(tag);
    });
  }

  async function startCheck() {
    const send = makeSender(root.parent);
    const request = readCheckRequest(root.location.search);
    if (!request) return send('error', { code: BAD_REQUEST });
    try {
      const turnstile = await loadTurnstileScript(root.document);
      return turnstile.render(WIDGET_SELECTOR, widgetOptions(request, send));
    } catch {
      return send('error', { code: SCRIPT_FAILED });
    }
  }

  const AppCheck = { APP_ORIGIN, MESSAGE_SOURCE, readCheckRequest, makeSender, widgetOptions };
  if (typeof module === 'object' && module.exports) {
    module.exports = AppCheck;
    return;
  }
  startCheck();
})(this);
