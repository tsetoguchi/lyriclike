// Google Analytics 4. Loaded by index.html and by every generated rhyme page,
// so the measurement id lives here and nowhere else — changing it never
// requires rebuilding the pages under /rhymes/.
//
// The tag is the only third-party script the site loads. _headers names
// googletagmanager and google-analytics in the CSP for it.
(function loadAnalytics() {
  'use strict';

  const MEASUREMENT_ID = 'G-L7J9BRE65Q';
  const TAG_URL = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  const PLACEHOLDER_ID = 'G-XXXXXXXXXX';

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

  const tag = document.createElement('script');
  tag.async = true;
  tag.src = TAG_URL;
  document.head.appendChild(tag);
})();
