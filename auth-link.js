// Emailed links arrive as /#signup_token=…, /#reset_token=…, /#shared=… (a
// page someone shared, with &signup=1 for someone with no account yet) or
// /#stop_token=… (stop invite mail). The value rides in the fragment so it
// never reaches request logs, and this script takes it out of the address bar
// and history before anything else runs, analytics included, since analytics
// reports the page URL. auth-forms.js picks the sign-in links up from
// window.authLink once the page is ready, sharing.js the other two; both call
// takeAuthLink again when a link is opened in a tab that already has the app.
(function initAuthLink() {
  'use strict';

  const LINK_KINDS = Object.freeze({
    signup_token: 'confirm', reset_token: 'reset', shared: 'shared', stop_token: 'stop',
  });
  const MAX_FRAGMENT_LENGTH = 512;

  // Returns { kind, token } and strips the fragment, or null when the address
  // holds no emailed link.
  function takeAuthLink() {
    const fragment = window.location.hash.slice(1);
    if (!fragment || fragment.length > MAX_FRAGMENT_LENGTH) return null;

    const params = new URLSearchParams(fragment);
    const found = Object.keys(LINK_KINDS).find(name => params.has(name));
    if (!found) return null;

    history.replaceState(null, '', window.location.pathname + window.location.search);
    return { kind: LINK_KINDS[found], token: params.get(found), signup: params.get('signup') === '1' };
  }

  window.takeAuthLink = takeAuthLink;
  window.authLink = takeAuthLink();
})();
