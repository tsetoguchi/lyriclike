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
  const MAX_ERROR_DESCRIPTION = 150;

  // Callers never have to check whether analytics is on.
  window.trackEvent = function ignoreEvent() {};

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
  gtag('config', MEASUREMENT_ID);

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

  window.addEventListener('error', event => {
    const file = (event.filename || '').split('/').pop();
    reportError(event.message + ' @ ' + file + ':' + event.lineno);
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    reportError('unhandled: ' + (reason && reason.message ? reason.message : reason));
  });

  const tag = document.createElement('script');
  tag.async = true;
  tag.src = TAG_URL;
  document.head.appendChild(tag);
})();
