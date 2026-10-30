// Google Analytics 4. Loaded by index.html and by every generated rhyme page,
// so the measurement id lives here and nowhere else — changing it never
// requires rebuilding the pages under /rhymes/.
//
// The tag is the only third-party script the site loads. _headers names
// googletagmanager and google-analytics in the CSP for it.
//
// window.trackEvent is how the app reports what people do. Never pass lyric
// text to it: the pad is private, and events leave the device.
(function loadAnalytics() {
  'use strict';

  const MEASUREMENT_ID = 'G-L7J9BRE65Q';
  const TAG_URL = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  const PLACEHOLDER_ID = 'G-XXXXXXXXXX';
  // GA cuts event values at 100 characters, so the location goes first.
  const MAX_ERROR_DESCRIPTION = 100;
  const STACK_SCRIPT_LOCATION = /([\w.-]+\.js):(\d+)/;
  // Set on the owner's own browsers, so a GA data filter can leave them out.
  const INTERNAL_KEY = 'internal_traffic';
  const INTERNAL_PARAM = 'internal';

  // Callers never have to check whether analytics is on.
  window.trackEvent = function ignoreEvent() {};

  // Reports a milestone the first time this device reaches it. The flag is
  // written first, so a storage failure stays quiet instead of repeating it.
  window.trackEventOnce = function trackEventOnce(storageKey, name) {
    try {
      if (localStorage.getItem(storageKey) !== null) return;
      localStorage.setItem(storageKey, '1');
    } catch {
      return;
    }
    window.trackEvent(name);
  };

  // Callers never have to check whether analytics is on.
  window.setSignedInProperty = function ignoreSignedIn() {};

  // Visiting any page with ?internal=1 marks this browser as the owner's;
  // ?internal=0 clears it. The mark stays on the device, never in the URL.
  function isInternalBrowser() {
    try {
      const requested = new URLSearchParams(window.location.search).get(INTERNAL_PARAM);
      if (requested === '1') localStorage.setItem(INTERNAL_KEY, '1');
      if (requested === '0') localStorage.removeItem(INTERNAL_KEY);
      return localStorage.getItem(INTERNAL_KEY) !== null;
    } catch {
      return false;
    }
  }

  // Fail loudly in the console rather than silently reporting to nowhere.
  if (MEASUREMENT_ID === PLACEHOLDER_ID) {
    console.warn('analytics.js: no measurement id set; analytics is off');
    return;
  }

  window.dataLayer = window.dataLayer || [];
  // gtag queues into dataLayer, so calls made before the tag arrives are kept.
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;

  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID, isInternalBrowser() ? { traffic_type: 'internal' } : {});

  // A yes/no flag only, so reports can split signed-in visitors from the rest
  // without GA ever holding an account id or an address.
  window.setSignedInProperty = function setSignedInProperty(isSignedIn) {
    gtag('set', 'user_properties', { signed_in: isSignedIn ? 'yes' : 'no' });
  };

  window.trackEvent = function trackEvent(name, params) {
    gtag('event', name, params || {});
  };

  // Without this, the editor could break on someone's phone and nobody would
  // ever hear about it.
  function reportError(description) {
    window.trackEvent('exception', {
      description: String(description).slice(0, MAX_ERROR_DESCRIPTION),
      fatal: false,
    });
  }

  // The first script frame in a stack, as "file.js:line", or '' without one.
  function stackLocation(stack) {
    const match = typeof stack === 'string' ? stack.match(STACK_SCRIPT_LOCATION) : null;
    return match ? match[1] + ':' + match[2] : '';
  }

  window.addEventListener('error', event => {
    const file = (event.filename || '').split('/').pop();
    reportError(file + ':' + event.lineno + ' ' + event.message);
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    const message = reason && reason.message ? reason.message : reason;
    const location = stackLocation(reason && reason.stack);
    reportError((location ? location + ' ' : '') + 'unhandled: ' + message);
  });

  const tag = document.createElement('script');
  tag.async = true;
  tag.src = TAG_URL;
  document.head.appendChild(tag);
})();
